import ethers from 'ethers';

class EthersCommon {
    constructor(providerAddress) {
        this.ethersProvider = new ethers.providers.JsonRpcProvider(providerAddress);

        this.erc1155Abi = [
            "function totalSupply(uint256 id) public view returns (uint256)",
            "function balanceOf(address account, uint256 id) external view returns (uint256)",
            "function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) external view returns (uint256[] memory)",
        ];

        this.erc721Abi = [
            "function totalSupply() external view returns (uint256)",
            "function balanceOf(address owner) external view returns (uint256 balance)",
            "function ownerOf(uint256 tokenId) external view returns (address owner)"
        ];
    }

    async getTotalSupplyByContractAddressAndType(contractAddress, type, tokenId = null) {
        let abi = type === 'ERC721' ? this.erc721Abi : this.erc1155Abi;
        let contract = new ethers.Contract(contractAddress, abi, this.ethersProvider);
        let totalSupply = ethers.BigNumber.from("0");

        try {
            totalSupply = type === 'ERC721' ? await contract.totalSupply() : await contract.totalSupply(tokenId);
        } catch (e) {
            console.error(e);
            return totalSupply;
        }

        return totalSupply;
    }
}

export default EthersCommon;