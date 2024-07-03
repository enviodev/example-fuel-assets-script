import { HyperfuelClient } from "@envio-dev/hyperfuel-client";
import {
  hyperFuelEndpoint,
} from "./config";
import { getMintedAssetId } from "@fuel-ts/transactions"
import { createInputsMap, createOutputsMap, inputsMapType, outputsMapType } from "./util";

async function main() {
  console.time("Script Execution Time");

  // Create hypersync client using the mainnet hypersync endpoint
  const client = HyperfuelClient.new({
    url: hyperFuelEndpoint,
  });

  const initialFromBlock = 518152; // First asset transaction on testnet.

  // The query to run
  const makeQuery = (fromBlock: number) => {
    // for docs on how this query works and where the fields come from, see: https://docs.envio.dev/docs/hyperfuel-query
    return {
      fromBlock: fromBlock,
      "receipts": [
        {
          "receiptType": [7, 8, 11, 12], // Removing Transfer and TransferOut for now since it is unclear how to get tho from/sender address
          "txStatus": [1] // only query for successful transactions
          // "receiptType": [11, 12]
        }
      ],
      "inputs": [{
        "inputType": [0 /* inputCoin */],
        "txStatus": [1] // only query for successful transactions
        // "tx_type": [0] // TODO: maybe can make this more efficient by filtering by tx_type
      }],
      "outputs": [{
        "outputType": [0 /* coinOutput */, 2 /* the change output is needed for calculating any unspent gas */],
        "txStatus": [1] // only query for successful transactions
        // "tx_type": [0] // TODO: maybe can make this more efficient by filtering by tx_type
      }],
      "fieldSelection": {
        "receipt": [
          "receipt_index",
          "root_contract_id",
          "tx_id",
          "tx_status",
          "to",
          "to_address",
          "amount",
          "asset_id",
          "val",
          "receipt_type",
          "sub_id",
          "sender",
          "recipient"
        ],
        "input": [
          "tx_id",
          // "tx_status",// unused currently
          // // "tx_type",// unused currently
          // "block_height",// unused currently
          // "input_type",// unused currently
          // "utxo_id",// unused currently
          "owner",
          "amount",
          "asset_id",
          // "tx_pointer_block_height",// unused currently
          // "tx_pointer_tx_index",// unused currently
          // "witness_index",// unused currently
          // "predicate_gas_used",// unused currently
          // "predicate",// unused currently
          // "predicate_data",// unused currently
          // "balance_root",// unused currently
          // "state_root",// unused currently
          // "contract",// unused currently
          // "sender",// unused currently
          // "recipient",// unused currently
          // "nonce",// unused currently
          // "data"// unused currently
        ],
        "output": [
          "tx_id",
          // "tx_status",// unused currently
          // // "tx_type",// unused currently
          // "block_height",// unused currently
          // "output_type",// unused currently
          "to",
          "amount",
          "asset_id",
          // "input_index", // unused currently
          // "balance_root",// unused currently
          // "state_root",// unused currently
          // "contract",// unused currently
        ]
      }
    }
  };


  let height = 999999999; // a large number, we'll reset this value regardless.

  // Fetch the current block height.
  //   do this asynchronously so the script is faster
  client.getHeight().then((block) => {
    // Set this asyncronously so that the script is still fast.
    height = block;
  });

  console.log("Running the query...");
  const tokenAssets: {
    [assetId: string]: {
      subId: string;
      mintingContract: string;
      supply: bigint;
      owners: {
        [address: string]: {
          in: bigint;
          out: bigint;
          count_in: number;
          count_out: number;
          last_balance_transaction: string;
        }
      }
    }
  } = {};

  const transaction_balances: {
    [address: string]: {
      [asset_id: string]: {
        [transaction: string]: {
          balance: bigint;
          last_balance_change_transaction_id: string;
        }
      }
    }
  } = {};

  const mintingContract: { [contractAddress: string]: Array<string> } = {};

  let fromBlock = initialFromBlock;

  let assetReceiptsProcessed = 0;

  while (fromBlock < height) {
    let result = await client.getSelectedData(makeQuery(fromBlock));

    assetReceiptsProcessed += result.data.receipts.length;

    console.log(`Processed ${assetReceiptsProcessed} asset receipts, up to block ${result.nextBlock - 1}`);

    fromBlock = result.nextBlock;

    let inputsMap: inputsMapType = {};
    let outputsMap: outputsMapType = {};

    for (const receipt of result.data.receipts) {
      const { txId, toAddress, to, val, amount, receiptType, recipient, rootContractId, subId, assetId } = receipt;

      if (receiptType === 11) { // MINT
        if (val == undefined || rootContractId == undefined || subId == undefined) {
          throw new Error("Malformed response from HyperFuel, required field cannot be undefined");
        }

        const assetId = getMintedAssetId(rootContractId, subId);

        let asset = tokenAssets[assetId];

        if (asset) {
          asset.supply = asset.supply + val;
        } else {
          const currentAssetsInContract = mintingContract[rootContractId] || [];
          mintingContract[rootContractId] = [...currentAssetsInContract, assetId];
          asset = {
            subId: subId,
            supply: val,
            mintingContract: rootContractId,
            owners: {}
          }
        }

        const recipient = asset.owners[rootContractId];
        if (recipient) {
          asset.owners[rootContractId]["in"] = recipient.in + val;
          asset.owners[rootContractId]["count_in"] = recipient.count_in + 1;
          const usersBalances = transaction_balances[rootContractId][assetId];

          if (usersBalances == undefined) throw new Error("User balance not found");

          if (recipient.last_balance_transaction == "NOT SET YET") {
            continue
          }
          const previousBalanceChange = usersBalances[recipient.last_balance_transaction];


          if (previousBalanceChange == undefined) throw new Error(`User previous balance not found. last change tx ${recipient.last_balance_transaction}, assetId: ${assetId}, user: ${rootContractId}`);

          usersBalances[txId] = {
            balance: previousBalanceChange.balance + val,
            last_balance_change_transaction_id: recipient.last_balance_transaction
          };

          if (usersBalances[txId].balance != (recipient.in - recipient.out)) throw new Error("Bad user balance math");
        } else {

          asset.owners[rootContractId] = {
            in: val,
            out: BigInt(0),
            count_in: 1,
            count_out: 0,
            last_balance_transaction: txId
          }

          const newUsersBalance = {
            balance: val,
            last_balance_change_transaction_id: "NONE"
          };

          const user = transaction_balances[rootContractId] || {};
          const userAsset = user[assetId] || {};

          transaction_balances[rootContractId] = {
            ...user,
            [assetId]: {
              ...userAsset,
              [txId]: newUsersBalance
            }
          }
        }

        tokenAssets[assetId] = asset;

      } else if (receiptType === 12) { // BURN

        // type 12 is a burn, so we need to subtract the value from the supply and do the reverse of the mint (11)
        if (val == undefined || rootContractId == undefined || subId == undefined) {
          throw new Error("Malformed response from HyperFuel, required field cannot be undefined");
        }

        const assetId = getMintedAssetId(rootContractId, subId);

        let asset = tokenAssets[assetId];

        if (!asset) {
          // search all assets to find the same subId
          throw new Error(`Burn event for an asset that was not minted - assetId: ${assetId}, subId: ${subId} from contract: ${rootContractId} - this happened at transaction ${receipt.txId} `)


        }

        asset.supply = asset.supply - val;

        const recipient = asset.owners[rootContractId];

        if (!recipient) {
          throw new Error("Burn event for an asset that has no owner");
        }

        asset.owners[rootContractId] = {
          in: recipient.in,
          out: recipient.out + val,
          count_in: recipient.count_in,
          count_out: recipient.count_out + 1,
          last_balance_transaction: "NOT SET YET"
        }

        const usersBalances = transaction_balances[rootContractId][assetId];

        if (usersBalances == undefined) throw new Error("User balance not found in burn");

        const previousBalanceChange = usersBalances[recipient.last_balance_transaction];

        if (usersBalances == undefined) throw new Error("User previous balance not found in burn");

        usersBalances[txId] = {
          balance: previousBalanceChange.balance - val,
          last_balance_change_transaction_id: recipient.last_balance_transaction
        };

        if (usersBalances[txId].balance != (recipient.in - recipient.out)) throw new Error("Bad user balance math in burn");
      } else if (receiptType === 7) {
        // Handle Transfer receipts
        if (amount == undefined || assetId == undefined || to == undefined) {
          console.log(receipt);
          throw new Error("Malformed response from HyperFuel of type Transfer, required field cannot be undefined");
        }

        if (rootContractId == undefined) {
          // This means this transfer is in a script, predicate or EOA. We need to look at the inputs/outputs of the transaction.
          if (inputsMap[txId] == undefined) {
            inputsMap = createInputsMap(result.data.inputs);
            if (inputsMap[txId] == undefined) throw new Error("Inputs map not created");
          }

          if (outputsMap[txId] == undefined) {
            outputsMap = createOutputsMap(result.data.outputs);
            if (outputsMap[txId] == undefined) throw new Error("Outputs map not created");
          }

          // Use the difference between inputs and outputs to determine the 'from address
          // Calculate the balance changes to determine the sender address.
          for (const assetId in outputsMap[txId]) {
            for (const owner in outputsMap[txId][assetId]) {
              const inputTotal = inputsMap[txId][assetId]?.[owner]?.reduce((sum, input) => sum + input.amount, BigInt(0)) || BigInt(0);
              const outputTotal = outputsMap[txId][assetId]?.[owner]?.reduce((sum, output) => sum + output.amount, BigInt(0)) || BigInt(0);

              if (inputTotal > outputTotal) {
                const senderAddress = owner;
                const recipientAddress = outputsMap[txId][assetId][owner][0]?.to;

                if (senderAddress && recipientAddress) {
                  if (!tokenAssets[assetId].owners[senderAddress]) {
                    tokenAssets[assetId].owners[senderAddress] = {
                      in: BigInt(0),
                      out: BigInt(0),
                      count_in: 0,
                      count_out: 0,
                      last_balance_transaction: "NOT SET YET"
                    };
                  }
                  if (!tokenAssets[assetId].owners[recipientAddress]) {
                    tokenAssets[assetId].owners[recipientAddress] = {
                      in: BigInt(0),
                      out: BigInt(0),
                      count_in: 0,
                      count_out: 0,
                      last_balance_transaction: "NOT SET YET"
                    };
                  }

                  tokenAssets[assetId].owners[senderAddress].out += outputTotal;
                  tokenAssets[assetId].owners[senderAddress].count_out += 1;

                  tokenAssets[assetId].owners[recipientAddress].in += outputTotal;
                  tokenAssets[assetId].owners[recipientAddress].count_in += 1;
                }

                //                 // Use the difference between inputs and outputs to determine the 'from address
                //                 // Calculate the balance changes to determine the sender address.
                //                 for (const assetId in outputsMap[txId]) {
                //                   for (const owner in outputsMap[txId][assetId]) {
                //                     const inputTotal = inputsMap[txId][assetId]?.[owner]?.reduce((sum, input) => sum + input.amount, BigInt(0)) || BigInt(0);
                //                     const outputTotal = outputsMap[txId][assetId]?.[owner]?.reduce((sum, output) => sum + output.amount, BigInt(0)) || BigInt(0);

                //                     if (inputTotal > outputTotal) {
                //                       const senderAddress = owner;
                //                       const recipientAddress = outputsMap[txId][assetId][owner][0]?.to;

                //                       if (senderAddress && recipientAddress) {
                //                         if (!tokenAssets[assetId].owners[senderAddress]) {
                //                           tokenAssets[assetId].owners[senderAddress] = {
                //                             in: BigInt(0),
                //                             out: BigInt(0),
                //                             count_in: 0,
                //                             count_out: 0,
                //                             last_balance_transaction: ""
                //                           };
                //                         }
                //                         if (!tokenAssets[assetId].owners[recipientAddress]) {
                //                           tokenAssets[assetId].owners[recipientAddress] = {
                //                             in: BigInt(0),
                //                             out: BigInt(0),
                //                             count_in: 0,
                //                             count_out: 0,
                //                             last_balance_transaction: ""
                //                           };
                //                         }

                //                         tokenAssets[assetId].owners[senderAddress].out += outputTotal;
                //                         tokenAssets[assetId].owners[senderAddress].count_out += 1;

                //                         tokenAssets[assetId].owners[recipientAddress].in += outputTotal;
                //                         tokenAssets[assetId].owners[recipientAddress].count_in += 1;
                //                       }
                //                     }
              }
            }
          }
        }



        let asset = tokenAssets[assetId];
        if (!asset) {
          continue; // Ignore transfers for assets that were not minted
        }

        // Update recipient information
        const recipientData = asset.owners[to];
        if (recipientData) {
          recipientData.in += amount;
          recipientData.count_in += 1;
        } else {
          asset.owners[to] = {
            in: amount,
            out: BigInt(0),
            count_in: 1,
            count_out: 0,
            last_balance_transaction: "NOT SET YET"
          }
        }

        // // Update sender information
        // const senderData = asset.owners[rootContractId];
        // if (senderData) {
        //   senderData.out += amount;
        //   senderData.count_out += 1;
        // } else {
        //   asset.owners[rootContractId] = {
        //     in: BigInt(0),
        //     out: amount,
        //     count_in: 0,
        //     count_out: 1
        //   }
        // }
      } else if (receiptType === 8) {
        // UNUSED code - still buggy.
        // Handle TransferOut receipts
        if (amount == undefined || assetId == undefined || toAddress == undefined) {
          throw new Error("Malformed response from HyperFuel of type TransferOut, required field cannot be undefined");
        }

        if (rootContractId == undefined) {
          // This means this transfer is in a script, predicate or EOA. We need to look at the inputs/outputs of the transaction.
          if (inputsMap[txId] == undefined) {
            // TODO construct the inputs map
          }
          if (outputsMap[txId] == undefined) {
            // TODO construct the inputs map
          }

          // Use the difference between inputs and outputs to determine the 'from address

          continue; // Not yet implemented
        }

        let asset = tokenAssets[assetId];
        if (!asset) {
          continue; // Ignore transfers for assets that were not minted
        }

        // Update recipient information
        const recipientData = asset.owners[toAddress];
        if (recipientData) {
          recipientData.in += amount;
          recipientData.count_in += 1;
        } else {
          asset.owners[toAddress] = {
            in: amount,
            out: BigInt(0),
            count_in: 1,
            count_out: 0,
            last_balance_transaction: "NOT SET YET"
          }
        }

        // Update sender information
        const senderData = asset.owners[rootContractId];
        if (senderData) {
          senderData.out += amount;
          senderData.count_out += 1;
        } else {
          asset.owners[rootContractId] = {
            in: BigInt(0),
            out: amount,
            count_in: 0,
            count_out: 1,
            last_balance_transaction: "NOT SET YET"
          }
        }
      }
    }
  }

  console.timeEnd("Script Execution Time");

  console.log("Token Summary:");
  for (const [contractAddress, assetIdsFromContract] of Object.entries(mintingContract)) {
    console.log(`Minting Contract: ${contractAddress}`);

    for (const assetId of assetIdsFromContract) {
      const asset = tokenAssets[assetId];
      if (!asset) {
        throw new Error("Asset not found, logic error mismatch between contractAssets and tokenAssets objects");
      }
      console.log(`  - Sub ID: ${asset.subId}`);
      console.log(`    Asset ID: ${assetId}`);
      console.log(`    Supply: ${asset.supply}`);
    }
  }
}
// }

main();

