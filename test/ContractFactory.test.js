const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ContractFactory", function () {
  let contractFactory;
  let templateRegistry;
  let reputationScoring;
  let owner;
  let arbitrator;
  let party1;
  let party2;
  let party3;

  const paramsHash = ethers.keccak256(ethers.toUtf8Bytes("contract-params-v1"));
  const templateHash = ethers.keccak256(ethers.toUtf8Bytes("service-template"));
  const metadata = "ipfs://QmTemplate";

  const ContractState = {
    Draft: 0,
    PendingSignatures: 1,
    Active: 2,
    Disputed: 3,
    Completed: 4,
    Terminated: 5
  };

  beforeEach(async function () {
    [owner, arbitrator, party1, party2, party3] = await ethers.getSigners();

    // Deploy dependencies
    const ReputationScoring = await ethers.getContractFactory("ReputationScoring");
    reputationScoring = await ReputationScoring.deploy(owner.address);
    await reputationScoring.waitForDeployment();

    const ContractTemplateRegistry = await ethers.getContractFactory("ContractTemplateRegistry");
    templateRegistry = await ContractTemplateRegistry.deploy(owner.address);
    await templateRegistry.waitForDeployment();

    // Deploy ContractFactory
    const ContractFactory = await ethers.getContractFactory("ContractFactory");
    contractFactory = await ContractFactory.deploy(
      owner.address,
      await templateRegistry.getAddress(),
      await reputationScoring.getAddress()
    );
    await contractFactory.waitForDeployment();

    // Grant roles
    const AUTHORIZED_CONTRACT_ROLE = await reputationScoring.AUTHORIZED_CONTRACT_ROLE();
    await reputationScoring.grantRole(AUTHORIZED_CONTRACT_ROLE, await contractFactory.getAddress());

    // Register a template
    await templateRegistry.registerTemplate(templateHash, metadata, arbitrator.address, 0);
  });

  describe("Deployment", function () {
    it("Should set correct template registry", async function () {
      expect(await contractFactory.templateRegistry()).to.equal(await templateRegistry.getAddress());
    });

    it("Should set correct reputation scoring", async function () {
      expect(await contractFactory.reputationScoring()).to.equal(await reputationScoring.getAddress());
    });

    it("Should start with zero contracts", async function () {
      expect(await contractFactory.totalContracts()).to.equal(0);
    });

    it("Should reject deployment with invalid template registry", async function () {
      const ContractFactory = await ethers.getContractFactory("ContractFactory");
      await expect(
        ContractFactory.deploy(owner.address, ethers.ZeroAddress, await reputationScoring.getAddress())
      ).to.be.revertedWith("Invalid template registry");
    });
  });

  describe("Contract Creation", function () {
    it("Should create a new contract", async function () {
      await contractFactory.createContract(
        1,
        paramsHash,
        [party1.address, party2.address],
        ethers.parseEther("1")
      );

      expect(await contractFactory.totalContracts()).to.equal(1);
    });

    it("Should emit ContractCreated event", async function () {
      await expect(
        contractFactory.createContract(
          1,
          paramsHash,
          [party1.address, party2.address],
          ethers.parseEther("1")
        )
      )
        .to.emit(contractFactory, "ContractCreated")
        .withArgs(1, 1, [party1.address, party2.address], arbitrator.address);
    });

    it("Should store correct contract data", async function () {
      await contractFactory.createContract(
        1,
        paramsHash,
        [party1.address, party2.address],
        ethers.parseEther("1")
      );

      const contract = await contractFactory.getContract(1);
      expect(contract.id).to.equal(1);
      expect(contract.templateId).to.equal(1);
      expect(contract.paramsHash).to.equal(paramsHash);
      expect(contract.parties).to.deep.equal([party1.address, party2.address]);
      expect(contract.arbitrator).to.equal(arbitrator.address);
      expect(contract.state).to.equal(ContractState.PendingSignatures);
      expect(contract.escrowRequired).to.equal(ethers.parseEther("1"));
    });

    it("Should track contracts by party", async function () {
      await contractFactory.createContract(
        1,
        paramsHash,
        [party1.address, party2.address],
        ethers.parseEther("1")
      );

      const party1Contracts = await contractFactory.getContractsByParty(party1.address);
      const party2Contracts = await contractFactory.getContractsByParty(party2.address);

      expect(party1Contracts).to.deep.equal([1n]);
      expect(party2Contracts).to.deep.equal([1n]);
    });

    it("Should record contract participation in reputation", async function () {
      await contractFactory.createContract(
        1,
        paramsHash,
        [party1.address, party2.address],
        ethers.parseEther("1")
      );

      const [,, totalContracts,,,,,] = await reputationScoring.getRawData(party1.address);
      expect(totalContracts).to.equal(1);
    });

    it("Should reject creation with less than 2 parties", async function () {
      await expect(
        contractFactory.createContract(1, paramsHash, [party1.address], ethers.parseEther("1"))
      ).to.be.revertedWith("Minimum 2 parties required");
    });

    it("Should reject creation without params hash", async function () {
      await expect(
        contractFactory.createContract(
          1,
          ethers.ZeroHash,
          [party1.address, party2.address],
          ethers.parseEther("1")
        )
      ).to.be.revertedWith("Params hash required");
    });

    it("Should reject creation with inactive template", async function () {
      await templateRegistry.deactivateTemplate(1);
      await expect(
        contractFactory.createContract(
          1,
          paramsHash,
          [party1.address, party2.address],
          ethers.parseEther("1")
        )
      ).to.be.revertedWith("Template not active");
    });

    it("Should reject creation with invalid party address", async function () {
      await expect(
        contractFactory.createContract(
          1,
          paramsHash,
          [party1.address, ethers.ZeroAddress],
          ethers.parseEther("1")
        )
      ).to.be.revertedWith("Invalid party address");
    });
  });

  describe("Contract Signing", function () {
    beforeEach(async function () {
      await contractFactory.createContract(
        1,
        paramsHash,
        [party1.address, party2.address],
        ethers.parseEther("1")
      );
    });

    it("Should allow party to sign", async function () {
      await contractFactory.connect(party1).signContract(1);
      expect(await contractFactory.hasSigned(1, party1.address)).to.be.true;
    });

    it("Should emit ContractSigned event", async function () {
      await expect(contractFactory.connect(party1).signContract(1))
        .to.emit(contractFactory, "ContractSigned")
        .withArgs(1, party1.address);
    });

    it("Should activate contract when all parties sign", async function () {
      await contractFactory.connect(party1).signContract(1);
      await contractFactory.connect(party2).signContract(1);

      const contract = await contractFactory.getContract(1);
      expect(contract.state).to.equal(ContractState.Active);
      expect(contract.activatedAt).to.be.gt(0);
    });

    it("Should emit ContractActivated event", async function () {
      await contractFactory.connect(party1).signContract(1);
      await expect(contractFactory.connect(party2).signContract(1))
        .to.emit(contractFactory, "ContractActivated");
    });

    it("Should reject signing from non-party", async function () {
      await expect(
        contractFactory.connect(party3).signContract(1)
      ).to.be.revertedWith("Not a party to this contract");
    });

    it("Should reject duplicate signing", async function () {
      await contractFactory.connect(party1).signContract(1);
      await expect(
        contractFactory.connect(party1).signContract(1)
      ).to.be.revertedWith("Already signed");
    });

    it("Should reject signing non-existent contract", async function () {
      await expect(
        contractFactory.connect(party1).signContract(999)
      ).to.be.revertedWith("Contract does not exist");
    });
  });

  describe("Arbitrator Override", function () {
    beforeEach(async function () {
      await contractFactory.createContract(
        1,
        paramsHash,
        [party1.address, party2.address],
        ethers.parseEther("1")
      );
    });

    it("Should allow arbitrator override", async function () {
      await contractFactory.connect(party1).setArbitrator(1, party3.address);

      const contract = await contractFactory.getContract(1);
      expect(contract.arbitrator).to.equal(party3.address);
    });

    it("Should reset signatures on arbitrator change", async function () {
      await contractFactory.connect(party1).signContract(1);
      expect(await contractFactory.hasSigned(1, party1.address)).to.be.true;

      await contractFactory.connect(party2).setArbitrator(1, party3.address);
      expect(await contractFactory.hasSigned(1, party1.address)).to.be.false;
    });

    it("Should reject override after activation", async function () {
      await contractFactory.connect(party1).signContract(1);
      await contractFactory.connect(party2).signContract(1);

      await expect(
        contractFactory.connect(party1).setArbitrator(1, party3.address)
      ).to.be.revertedWith("Contract already active");
    });

    it("Should reject override from non-party", async function () {
      await expect(
        contractFactory.connect(party3).setArbitrator(1, party3.address)
      ).to.be.revertedWith("Not a party to this contract");
    });
  });

  describe("Contract State Management", function () {
    beforeEach(async function () {
      await contractFactory.createContract(
        1,
        paramsHash,
        [party1.address, party2.address],
        ethers.parseEther("1")
      );
      await contractFactory.connect(party1).signContract(1);
      await contractFactory.connect(party2).signContract(1);
    });

    it("Should mark contract as disputed", async function () {
      await contractFactory.markDisputed(1);

      const contract = await contractFactory.getContract(1);
      expect(contract.state).to.equal(ContractState.Disputed);
    });

    it("Should emit ContractDisputed event", async function () {
      await expect(contractFactory.markDisputed(1))
        .to.emit(contractFactory, "ContractDisputed")
        .withArgs(1);
    });

    it("Should mark contract as completed", async function () {
      await contractFactory.markCompleted(1);

      const contract = await contractFactory.getContract(1);
      expect(contract.state).to.equal(ContractState.Completed);
    });

    it("Should emit ContractCompleted event", async function () {
      await expect(contractFactory.markCompleted(1))
        .to.emit(contractFactory, "ContractCompleted")
        .withArgs(1);
    });

    it("Should allow completing disputed contract", async function () {
      await contractFactory.markDisputed(1);
      await contractFactory.markCompleted(1);

      const contract = await contractFactory.getContract(1);
      expect(contract.state).to.equal(ContractState.Completed);
    });

    it("Should reject disputing non-active contract", async function () {
      await contractFactory.markCompleted(1);
      await expect(contractFactory.markDisputed(1))
        .to.be.revertedWith("Contract not active");
    });
  });

  describe("Contract Termination", function () {
    beforeEach(async function () {
      await contractFactory.createContract(
        1,
        paramsHash,
        [party1.address, party2.address],
        ethers.parseEther("1")
      );
    });

    it("Should allow party to terminate pending contract", async function () {
      await contractFactory.connect(party1).terminateContract(1, "Changed mind");

      const contract = await contractFactory.getContract(1);
      expect(contract.state).to.equal(ContractState.Terminated);
    });

    it("Should allow party to terminate active contract", async function () {
      await contractFactory.connect(party1).signContract(1);
      await contractFactory.connect(party2).signContract(1);

      await contractFactory.connect(party1).terminateContract(1, "Mutual agreement");

      const contract = await contractFactory.getContract(1);
      expect(contract.state).to.equal(ContractState.Terminated);
    });

    it("Should emit ContractTerminated event", async function () {
      await expect(contractFactory.connect(party1).terminateContract(1, "Reason"))
        .to.emit(contractFactory, "ContractTerminated")
        .withArgs(1, "Reason");
    });

    it("Should reject termination from non-party", async function () {
      await expect(
        contractFactory.connect(party3).terminateContract(1, "Reason")
      ).to.be.revertedWith("Not authorized");
    });

    it("Should reject terminating completed contract", async function () {
      await contractFactory.connect(party1).signContract(1);
      await contractFactory.connect(party2).signContract(1);
      await contractFactory.markCompleted(1);

      await expect(
        contractFactory.connect(party1).terminateContract(1, "Reason")
      ).to.be.revertedWith("Cannot terminate in current state");
    });
  });

  describe("View Functions", function () {
    it("Should correctly identify parties", async function () {
      await contractFactory.createContract(
        1,
        paramsHash,
        [party1.address, party2.address],
        ethers.parseEther("1")
      );

      expect(await contractFactory.isParty(1, party1.address)).to.be.true;
      expect(await contractFactory.isParty(1, party2.address)).to.be.true;
      expect(await contractFactory.isParty(1, party3.address)).to.be.false;
    });

    it("Should revert getContract for non-existent contract", async function () {
      await expect(contractFactory.getContract(999))
        .to.be.revertedWith("Contract does not exist");
    });
  });
});
