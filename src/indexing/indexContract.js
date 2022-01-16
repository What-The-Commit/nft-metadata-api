import ethers from "ethers";
import models from "../models/index.js";
import {RateLimit} from "async-sema";
import Asset from "../models/asset.js";
import Metadata from "./metadata.js";

class IndexContract {
    constructor(ethersProvider) {
        this.ethersProvider = new ethers.providers.JsonRpcProvider(ethersProvider);
        this.metadata = new Metadata(ethersProvider);
    }

    async index(contractAddress) {
        try {
            contractAddress = ethers.utils.getAddress(contractAddress);
        } catch (e) {
            throw {message: 'Invalid contract address', contract: contractAddress};
        }

        try {
            let contract = new ethers.Contract(
                contractAddress,
                [
                    'function totalSupply() external view returns (uint256)',
                    'function tokenURI(uint256 tokenId) external view returns (string memory)'
                ],
                this.ethersProvider
            );

            let totalSupply = await contract.totalSupply();

            let startingTokenId = 0;

            try {
                await contract.tokenURI(startingTokenId);
            } catch (e) {
                startingTokenId += 1;
                await contract.tokenURI(startingTokenId);
            }

            let indexedTokenIds = await models.Asset.find({contract: contractAddress}, {tokenId: 1}, {lean: true}).exec();

            let metadataCalls = [];

            const rateLimit = RateLimit(process.env.ETHERS_PROVIDER_RATELIMIT_MIN, {timeUnit: 60000, uniformDistribution: true});

            for (let i = startingTokenId; i < totalSupply; i++) {
                let tokenIdExists = indexedTokenIds.findIndex(function (indexedTokenId) {
                   if (indexedTokenId.tokenId === i) {
                       return true
                   }
                });

                if (tokenIdExists !== -1) {
                    continue;
                }

                await rateLimit();

                let call = this.metadata.getMetadata(contractAddress, i);

                call.then(async function (metadata) {
                    await Asset.createFromContractByMetadata(contractAddress, metadata);
                    console.debug('asset saved ' + i, contractAddress);
                }).catch(error => console.log(contractAddress, error));

                metadataCalls.push(call);
            }

            await Promise.allSettled(metadataCalls);
        } catch (error) {
            console.error(contractAddress, error);
            throw error;
        }
    }
}

export default IndexContract;