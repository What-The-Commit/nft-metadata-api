import fetch from "node-fetch";
import ethers from "ethers";

class Metadata {
    constructor(ethersProvider) {
        this.ethersProvider = new ethers.providers.JsonRpcProvider(ethersProvider);
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
                    response = await fetch('https://ipfs.io/ipfs/' + metadata.host + metadata.pathname);
                    responseBody = await response.text();

                    if (responseBody.indexOf('invalid ipfs path: ') !== -1) {
                        throw {message: responseBody, usedUrl: 'https://ipfs.io/ipfs/' + metadata.host};
                    }

                    responseBody = JSON.parse(responseBody);
                    responseBody.tokenId = tokenId;

                    return responseBody;
                case "http:":
                case "https:":
                    console.log(metadata.href, metadata);
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