import fetch from "node-fetch";
import ethers from "ethers";

class Metadata {
    constructor(ethersProvider, ipfsRateLimit) {
        this.ethersProvider = new ethers.providers.JsonRpcProvider(ethersProvider);
        this.ipfsRateLimit = ipfsRateLimit;
    }

    async getMetadata(contractAddress, tokenId) {
        let contract = new ethers.Contract(
            contractAddress,
            [
                'function totalSupply() external view returns (uint256)',
                'function tokenURI(uint256 tokenId) external view returns (string memory)'
            ],
            this.ethersProvider
        );

        let metadataUrl = await contract.tokenURI(tokenId);
        let response;
        let responseBody;

        let metadata = new URL(metadataUrl);

        try {
            switch (metadata.protocol) {
                case "ipfs:":
                    await this.ipfsRateLimit();

                    response = await fetch('https://gateway.pinata.cloud/ipfs/' + metadata.host.replace('ipfs/', '') + metadata.pathname);
                    responseBody = await response.text();

                    if (responseBody.indexOf('invalid ipfs path: ') !== -1) {
                        let error = new Error('IPFS metadata error');
                        error.responseBody = responseBody;
                        error.url = 'https://gateway.pinata.cloud/ipfs/' + metadata.host.replace('ipfs/', '') + metadata.pathname;

                        throw error;
                    }

                    responseBody = JSON.parse(responseBody);
                    responseBody.tokenId = tokenId;

                    return responseBody;
                case "http:":
                case "https:":
                    response = await fetch(metadata.href);
                    responseBody = await response.json();

                    responseBody.tokenId = tokenId;

                    return responseBody;
                case "data:":
                    responseBody = JSON.parse(atob(metadata.href.replace('data:application/json;base64,', '')));
                    responseBody.tokenId = tokenId;

                    return responseBody;
            }
        } catch (error) {
            error.url = metadataUrl;
            error.parsedUrl = metadata;
            error.responseBody = responseBody;
            throw error;
        }
    }
}

export default Metadata;