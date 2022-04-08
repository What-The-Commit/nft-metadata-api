import {utils} from 'ethers';
import env from 'dotenv';
import models, {connectDb} from './models/index.js';
import IndexContract from "./indexing/indexContract.js";
import Yargs from "yargs";
import {hideBin} from "yargs/helpers";

env.config();

const yargs = Yargs(hideBin(process.argv))
    .command('index-contracts', 'index metadata of given contracts')
    .option('provider', {
        type: 'string',
        demandOption: true,
        requireArg: true,
        description: 'Json RPC Provider'
    })
    .option('network', {
        type: 'string',
        demandOption: true,
        requireArg: true,
        description: 'Network of provider'
    })
    .option('contract', {
        type: 'string',
        array: true,
        demandOption: true,
        requireArg: true,
        description: 'Contract addresses'
    })
    .option('erc721', {
        type: 'boolean',
        conflicts: 'erc1155',
        description: 'Index an ERC721 contract'
    })
    .option('erc1155', {
        type: 'boolean',
        conflicts: 'erc721',
        description: 'Index an ERC1155 contract'
    })
    .option('tokenId', {
        type: 'number',
        array: true,
        implies: 'erc1155',
        description: 'Token ids to index'
    })
;

const provider = yargs.argv.provider;
const network = yargs.argv.network;
let contracts = yargs.argv.contract;
const tokenIds = yargs.argv.tokenId;

connectDb().then(async function () {
    const indexContract = new IndexContract(provider, network, process.env.IPFS_HOSTS.split(' '));

    if (contracts[0] === undefined) {
        contracts = await models.Asset.distinct('contract').exec();
    }

    for (const contract of contracts) {
        let contractAddress;

        try {
            contractAddress = utils.getAddress(contract);
        } catch (e) {
            console.error({message: 'Invalid contract address', contract: contractAddress});
            continue;
        }

        try {
            if (yargs.argv.erc721) {
                await indexContract.indexErc721(contractAddress);
            }

            if (yargs.argv.erc1155) {
                await indexContract.indexErc1155(contractAddress, tokenIds);
            }
        } catch (error) {
            console.error(contractAddress, error);
            continue;
        }
    }
});