import { HyperfuelClient } from "@envio-dev/hyperfuel-client";
import {
  hyperFuelEndpoint,
} from "./config";
import { getMintedAssetId } from "@fuel-ts/transactions"
import { createInputsMap, createOutputsMap, inputsMapType, outputsMapType } from "./util";

// TODO - we have avoided indexing the BASE asset id so far - we need to handle it also.
const base_asset_id = "0xf8f8b6283d7fa5b672b530cbb84fcccb4ff8dc40f8176ef4544ddb1f1952ad07"

async function main() {
  console.time("Script Execution Time");

  // Create hypersync client using the mainnet hypersync endpoint
  const client = HyperfuelClient.new({
    url: hyperFuelEndpoint,
  });

  const initialFromBlock = 1219561; // First asset transaction on testnet.

  // The query to run
  const makeQuery = (fromBlock: number) => {
    // for docs on how this query works and where the fields come from, see: https://docs.envio.dev/docs/hyperfuel-query
    return {
      fromBlock: fromBlock,
      toBlock: fromBlock + 1,
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

  let result = await client.getSelectedData(makeQuery(initialFromBlock));
  console.log(result);

  const txId = "0x241203072ffc6c091a3072ae7e0073d13880b53ed5e7a97d18eb2b2d9300ecc7"

  const inputsMap = createInputsMap(result.data.inputs);
  const outputsMap = createOutputsMap(result.data.outputs);

  console.log("Inputs Map: ", inputsMap, result.data.inputs);
  console.log("Outputs Map: ", outputsMap, result.data.outputs);
  const inputs = inputsMap[txId];
  const output = outputsMap[txId];

  const inputTotals: { [assetId: string]: bigint } = {};
  const outputTotals: { [assetId: string]: bigint } = {};

  Object.keys(inputs).map((assetId) => {
    Object.keys(inputs[assetId]).map((owner) => {
      if (inputTotals[assetId] == undefined) {
        inputTotals[assetId] = 0n;
      }
      const coinInputs = inputs[assetId][owner];
      coinInputs.forEach((coinInput) => {
        inputTotals[assetId] = coinInput.amount + (inputTotals[assetId]);
      })
    })
  })

  Object.keys(output).map((assetId) => {
    Object.keys(output[assetId]).map((owner) => {
      if (outputTotals[assetId] == undefined) {
        outputTotals[assetId] = 0n;
      }
      const coinOutputs = output[assetId][owner];
      coinOutputs.forEach((coinOutput) => {
        outputTotals[assetId] = coinOutput.amount + (outputTotals[assetId]);
      })
    })
  })

  for (const receipt of result.data.receipts) {
    const { txId, toAddress, to, val, amount, receiptType, recipient, rootContractId, subId, assetId } = receipt;

    if (receiptType === 11) {
      if (val == undefined || rootContractId == undefined || subId == undefined) {
        throw new Error("Malformed response from HyperFuel, required field cannot be undefined");
      }

      // Mint
      const mintedAssetId = getMintedAssetId(rootContractId, subId);
      if (inputTotals[mintedAssetId] == undefined) {
        inputTotals[mintedAssetId] = 0n;
      }
      if (outputTotals[mintedAssetId] == undefined) {
        outputTotals[mintedAssetId] = 0n;
      }
      console.log(`Minted ${val} of asset ${mintedAssetId} to ${toAddress}`);
      inputTotals[mintedAssetId] = inputTotals[mintedAssetId] + val;
      outputTotals[mintedAssetId] = outputTotals[mintedAssetId] + val;
    } else if (receiptType === 12) {
      if (val == undefined || rootContractId == undefined || subId == undefined) {
        throw new Error("Malformed response from HyperFuel, required field cannot be undefined");
      }

      // BURN
      const burnAssetId = getMintedAssetId(rootContractId, subId);
      if (inputTotals[burnAssetId] == undefined) {
        inputTotals[burnAssetId] = 0n;
      }
      if (outputTotals[burnAssetId] == undefined) {
        outputTotals[burnAssetId] = 0n;
      }
      console.log(`Burnt ${val} of asset ${burnAssetId} to ${toAddress}`);
      inputTotals[burnAssetId] = inputTotals[burnAssetId] - val;
      outputTotals[burnAssetId] = outputTotals[burnAssetId] - val;
    } else if (receiptType === 7 || receiptType === 8) {
      if (amount == undefined || assetId == undefined) {
        throw new Error("Malformed response from HyperFuel, required field cannot be undefined");
      }

      if (rootContractId != undefined) {
        continue;
      }

      // Mint
      if (inputTotals[assetId] == undefined) {
        inputTotals[assetId] = 0n;
      }
      if (outputTotals[assetId] == undefined) {
        outputTotals[assetId] = 0n;
      }
      console.log(`transfer ${amount} of asset ${assetId} to ${toAddress}`);
      outputTotals[assetId] = outputTotals[assetId] + amount;
    }
  }

  console.log("Input Totals: ", inputTotals);
  console.log("Output Totals: ", outputTotals);
}
// }

main();

