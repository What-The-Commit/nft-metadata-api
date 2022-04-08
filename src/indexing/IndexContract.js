import ethers from "ethers";
import models from "../models/index.js";
import {RateLimit} from "async-sema";
import Asset from "../models/asset.js";
import Metadata from "./Metadata.js";

class IndexContract {
    constructor(ethersProvider, network, type, ipfsHosts) {
        this.ethersProvider = new ethers.providers.JsonRpcProvider(ethersProvider, network);
        this.metadata = new Metadata(ethersProvider, network, ipfsHosts);
    }

    async indexErc721(contractAddress) {
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

            const metadataRateLimit = new RateLimit(10);

            for (let i = startingTokenId; i < totalSupply; i++) {
                let tokenIdExists = indexedTokenIds.findIndex(function (indexedTokenId) {
                   if (indexedTokenId.tokenId === i) {
                       return true
                   }
                });

                if (tokenIdExists !== -1) {
                    continue;
                }

                const metadataUrl = await contract.tokenURI(i);

                await metadataRateLimit();
                let call = this.metadata.getMetadata(metadataUrl, i);

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

    async indexErc1155(contractAddress, tokenIds) {
        try {
            contractAddress = ethers.utils.getAddress(contractAddress);
        } catch (e) {
            throw {message: 'Invalid contract address', contract: contractAddress};
        }

        try {
            let contract = new ethers.Contract(
                contractAddress,
                [
                    'function uri(uint256 tokenId) public view returns (string memory)'
                ],
                this.ethersProvider
            );

            let indexedTokenIds = await models.Asset.find({contract: contractAddress}, {tokenId: 1}, {lean: true}).exec();

            let metadataCalls = [];

            const metadataRateLimit = new RateLimit(10);

            for (const tokenId of tokenIds) {
                let tokenIdExists = indexedTokenIds.findIndex(function (indexedTokenId) {
                    if (indexedTokenId.tokenId === tokenId) {
                        return true
                    }
                });

                if (tokenIdExists !== -1) {
                    continue;
                }

                const metadataUrl = await contract.uri(tokenId);

                await metadataRateLimit();
                let call = this.metadata.getMetadata(metadataUrl, tokenId);

                call
                    .then(async function (metadata) {
                        await Asset.createFromContractByMetadata(contractAddress, metadata);
                        console.debug('asset saved ' + tokenId, contractAddress);
                    })
                    .catch(error => console.log(contractAddress, error));

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