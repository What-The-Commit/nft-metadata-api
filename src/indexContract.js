import {utils} from 'ethers';
import env from 'dotenv';
import models, {connectDb} from './models/index.js';
import IndexContract from "./indexing/indexContract.js";

env.config();

connectDb().then(async function () {
    const indexContract = new IndexContract(process.env.ETHERS_PROVIDER, process.env.IPFS_HOST);

    const contractAddresses = process.argv[2];

    if (contractAddresses === undefined) {
        console.info('Please provide contract addresses');
        process.exit();
    }

    let contracts = process.argv[2].split(',');

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
            await indexContract.index(contractAddress);
        } catch (error) {
            console.error(contractAddress, error);
            continue;
        }
    }

    process.exit();
});