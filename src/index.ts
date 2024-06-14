import { HyperfuelClient } from "@envio-dev/hyperfuel-client";
import {
  hyperFuelEndpoint,
} from "./config";
import { getMintedAssetId } from "@fuel-ts/transactions"

const transferEventSigHash =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

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
          // "receiptType": [7, 8, 11, 12] // Removing Transfer and TransferOut for now since it is unclear how to get tho from/sender address
          "receiptType": [11, 12]
        }
      ],
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

    for (const receipt of result.data.receipts) {
      const { toAddress, to, val, amount, receiptType, recipient, rootContractId, subId, assetId } = receipt;

      if (receiptType === 11) {
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
        } else {
          asset.owners[rootContractId] = {
            in: val,
            out: BigInt(0),
            count_in: 1,
            count_out: 0
          }
        }

        tokenAssets[assetId] = asset;
      } else if (receiptType === 12) {

        // type 12 is a burn, so we need to subtract the value from the supply and do the reverse of the mint (11)
        if (val == undefined || rootContractId == undefined || subId == undefined) {
          throw new Error("Malformed response from HyperFuel, required field cannot be undefined");
        }

        if (rootContractId == "0x3550c53890db64a241d3cc6523d4255a9c588c4bd8503f911a39444989626626") {
          continue;
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
          count_out: recipient.count_out + 1
        }
      } else if (receiptType === 7) {
        // UNUSED code - still buggy.
        // Handle Transfer receipts
        if (amount == undefined || assetId == undefined || to == undefined || rootContractId == undefined) {
          console.log(receipt);
          throw new Error("Malformed response from HyperFuel of type Transfer, required field cannot be undefined");
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
            count_out: 0
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
            count_out: 1
          }
        }
      } else if (receiptType === 8) {
        // UNUSED code - still buggy.
        // Handle TransferOut receipts
        if (amount == undefined || assetId == undefined || toAddress == undefined || rootContractId == undefined) {
          throw new Error("Malformed response from HyperFuel of type TransferOut, required field cannot be undefined");
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
            count_out: 0
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
            count_out: 1
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

main();

