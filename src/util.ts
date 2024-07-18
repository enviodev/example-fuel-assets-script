import { HyperfuelClient, Input, Output } from "@envio-dev/hyperfuel-client";

export type inputsMapTx = {
  [assetId: string]: {
    [ownerAddress: string]: [{
      txId: string,
      // txStatus: number,
      // txType: number,
      // blockHeight: number,
      // inputType: number,
      // utxoId: string,
      owner: string | undefined,
      amount: bigint,
      assetId: string,
      // txPointerBlockHeight: number,
      // txPointerTxIndex: number,
      // witnessIndex: number,
      // predicateGasUsed: number,
      // predicate: string,
      // predicateData: string,
      // balanceRoot: string,
      // stateRoot: string,
      // contract: string,
      // sender: string,
      // recipient: string,
      // nonce: string,
      // data: string
    }]
  }
}
export type inputsMapType = {
  [txId: string]: inputsMapTx
};

export type outputsMapType = {
  [txId: string]: {
    [assetId: string]: {
      [ownerAddress: string]: [{
        txId: string,
        // txStatus: number,
        // txType: number,
        // blockHeight: number,
        // outputType: number,
        to: string,
        amount: bigint,
        assetId: string,
        // inputIndex: number,
        // balanceRoot: string,
        // stateRoot: string,
        // contract: string,
      }]
    }
  }
};
/// TODO: don't ignore this!
const base_asset_id = "0xf8f8b6283d7fa5b672b530cbb84fcccb4ff8dc40f8176ef4544ddb1f1952ad07"

export const createInputsMap = (inputs: Array<Input>): inputsMapType => {
  const inputsMap: inputsMapType = {};
  for (const input of inputs) {
    const { assetId, owner } = input;
    // if (assetId == base_asset_id) continue;
    if (assetId == undefined || owner == undefined) {
      throw new Error("Malformed response from HyperFuel of type input, required fields cannot be undefined");
    }

    const {
      // txStatus
      // , txType
      // , blockHeight
      // , inputType
      // , utxoId
      // , owner
      amount
      // , assetId
      // , txPointerBlockHeight
      // , txPointerTxIndex
      // , witnessIndex
      // , predicateGasUsed
      // , predicate
      // , predicateData
      // , balanceRoot
      // , stateRoot
      // , contract
      // , sender
      // , recipient
      // , nonce
      // , data
      , txId
    } = input

    if (!inputsMap[txId]) {
      inputsMap[txId] = {};
    }
    if (!inputsMap[txId][assetId]) {
      inputsMap[txId][assetId] = {};
    }
    if (!inputsMap[txId][assetId][owner]) {
      inputsMap[txId][assetId][owner] = [] as any;
    }

    if (
      // utxoId != undefined &&
      amount != undefined
      // utxoId != undefined &&
      // txPointerBlockHeight != undefined &&
      // txPointerTxIndex != undefined &&
      // witnessIndex != undefined &&
      // predicateGasUsed != undefined &&
      // predicate != undefined &&
      // predicateData != undefined &&
      // balanceRoot != undefined &&
      // stateRoot != undefined &&
      // contract != undefined &&
      // sender != undefined &&
      // recipient != undefined &&
      // nonce != undefined &&
      // data != undefined
    ) {
      inputsMap[txId][assetId][owner].push({
        txId
        // txStatus
        // , txType
        // , blockHeight
        // , inputType
        , owner
        , assetId
        // , utxoId
        , amount
        // , txPointerBlockHeight
        // , txPointerTxIndex
        // , witnessIndex
        // , predicateGasUsed
        // , predicate
        // , predicateData
        // , balanceRoot
        // , stateRoot
        // , contract
        // , sender
        // , recipient
        // , nonce
        // , data
      });
    } else {
      throw new Error("Malformed response from HyperFuel of type input, required fields cannot be undefined");
    }
  }

  return inputsMap;
}

export const createOutputsMap = (outputs: Array<Output>): outputsMapType => {
  const outputsMap: outputsMapType = {};

  for (const output of outputs) {
    const {
      txId,
      // txStatus,
      // txType,
      // blockHeight,
      // outputType,
      to,
      amount,
      assetId,
      // inputIndex,
      // balanceRoot,
      // stateRoot,
      // contract
    } = output
    // if (assetId == base_asset_id) continue;
    if (txId != undefined &&
      // txStatus != undefined &&
      // txType != undefined &&
      // blockHeight != undefined &&
      // outputType != undefined &&
      to != undefined &&
      amount != undefined &&
      assetId != undefined
      // inputIndex != undefined &&
      // balanceRoot != undefined &&
      // stateRoot != undefined &&
      // contract != undefined
    ) {
      if (!outputsMap[txId]) {
        outputsMap[txId] = {};
      }
      if (!outputsMap[txId][assetId]) {
        outputsMap[txId][assetId] = {};
      }
      if (!outputsMap[txId][assetId][to]) {
        outputsMap[txId][assetId][to] = [] as any;
      }
      outputsMap[txId][assetId][to].push({
        txId,
        // txStatus,
        // txType,
        // blockHeight,
        // outputType,
        to,
        amount,
        assetId,
        // inputIndex,
        // balanceRoot,
        // stateRoot,
        // contract,
      });
    } else {
      throw new Error("Malformed response from HyperFuel of type output, required fields cannot be undefined");
    }
  }

  return outputsMap;
}
