const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ContractTemplateRegistry", function () {
  let templateRegistry;
  let owner;
  let admin;
  let arbitrator;
  let user1;

  const templateHash = ethers.keccak256(ethers.toUtf8Bytes("service-contract-template-v1"));
  const metadata = "ipfs://QmServiceContractTemplate";
  const Category = {
    Service: 0,
    Sale: 1,
    Loan: 2,
    Employment: 3,
    Escrow: 4,
    Custom: 5
  };

  beforeEach(async function () {
    [owner, admin, arbitrator, user1] = await ethers.getSigners();

    const ContractTemplateRegistry = await ethers.getContractFactory("ContractTemplateRegistry");
    templateRegistry = await ContractTemplateRegistry.deploy(owner.address);
    await templateRegistry.waitForDeployment();

    // Grant template admin role
    const TEMPLATE_ADMIN_ROLE = await templateRegistry.TEMPLATE_ADMIN_ROLE();
    await templateRegistry.grantRole(TEMPLATE_ADMIN_ROLE, admin.address);
  });

  describe("Deployment", function () {
    it("Should grant admin role to deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await templateRegistry.DEFAULT_ADMIN_ROLE();
      expect(await templateRegistry.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should grant template admin role to deployer", async function () {
      const TEMPLATE_ADMIN_ROLE = await templateRegistry.TEMPLATE_ADMIN_ROLE();
      expect(await templateRegistry.hasRole(TEMPLATE_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should start with zero templates", async function () {
      expect(await templateRegistry.totalTemplates()).to.equal(0);
      expect(await templateRegistry.activeTemplateCount()).to.equal(0);
    });
  });

  describe("Template Registration", function () {
    it("Should register a new template", async function () {
      await templateRegistry.connect(admin).registerTemplate(
        templateHash,
        metadata,
        arbitrator.address,
        Category.Service
      );

      expect(await templateRegistry.totalTemplates()).to.equal(1);
      expect(await templateRegistry.activeTemplateCount()).to.equal(1);
    });

    it("Should emit TemplateRegistered event", async function () {
      await expect(
        templateRegistry.connect(admin).registerTemplate(
          templateHash,
          metadata,
          arbitrator.address,
          Category.Service
        )
      )
        .to.emit(templateRegistry, "TemplateRegistered")
        .withArgs(1, templateHash, arbitrator.address, Category.Service);
    });

    it("Should store correct template data", async function () {
      await templateRegistry.connect(admin).registerTemplate(
        templateHash,
        metadata,
        arbitrator.address,
        Category.Service
      );

      const template = await templateRegistry.getTemplate(1);
      expect(template.id).to.equal(1);
      expect(template.templateHash).to.equal(templateHash);
      expect(template.metadata).to.equal(metadata);
      expect(template.defaultArbitrator).to.equal(arbitrator.address);
      expect(template.category).to.equal(Category.Service);
      expect(template.active).to.be.true;
      expect(template.usageCount).to.equal(0);
    });

    it("Should reject registration without template hash", async function () {
      await expect(
        templateRegistry.connect(admin).registerTemplate(
          ethers.ZeroHash,
          metadata,
          arbitrator.address,
          Category.Service
        )
      ).to.be.revertedWith("Template hash required");
    });

    it("Should reject registration without metadata", async function () {
      await expect(
        templateRegistry.connect(admin).registerTemplate(
          templateHash,
          "",
          arbitrator.address,
          Category.Service
        )
      ).to.be.revertedWith("Metadata required");
    });

    it("Should reject registration without arbitrator", async function () {
      await expect(
        templateRegistry.connect(admin).registerTemplate(
          templateHash,
          metadata,
          ethers.ZeroAddress,
          Category.Service
        )
      ).to.be.revertedWith("Default arbitrator required");
    });

    it("Should reject registration from non-admin", async function () {
      await expect(
        templateRegistry.connect(user1).registerTemplate(
          templateHash,
          metadata,
          arbitrator.address,
          Category.Service
        )
      ).to.be.reverted;
    });
  });

  describe("Template Updates", function () {
    beforeEach(async function () {
      await templateRegistry.connect(admin).registerTemplate(
        templateHash,
        metadata,
        arbitrator.address,
        Category.Service
      );
    });

    it("Should update metadata", async function () {
      const newMetadata = "ipfs://QmUpdatedTemplate";
      await templateRegistry.connect(admin).updateMetadata(1, newMetadata);

      const template = await templateRegistry.getTemplate(1);
      expect(template.metadata).to.equal(newMetadata);
    });

    it("Should emit TemplateUpdated event", async function () {
      const newMetadata = "ipfs://QmUpdatedTemplate";
      await expect(templateRegistry.connect(admin).updateMetadata(1, newMetadata))
        .to.emit(templateRegistry, "TemplateUpdated")
        .withArgs(1, newMetadata);
    });

    it("Should update default arbitrator", async function () {
      await templateRegistry.connect(admin).updateDefaultArbitrator(1, user1.address);

      const template = await templateRegistry.getTemplate(1);
      expect(template.defaultArbitrator).to.equal(user1.address);
    });

    it("Should reject update for non-existent template", async function () {
      await expect(
        templateRegistry.connect(admin).updateMetadata(999, "new-metadata")
      ).to.be.revertedWith("Template does not exist");
    });
  });

  describe("Template Activation", function () {
    beforeEach(async function () {
      await templateRegistry.connect(admin).registerTemplate(
        templateHash,
        metadata,
        arbitrator.address,
        Category.Service
      );
    });

    it("Should deactivate a template", async function () {
      await templateRegistry.connect(admin).deactivateTemplate(1);

      const [exists, active] = await templateRegistry.isTemplateActive(1);
      expect(exists).to.be.true;
      expect(active).to.be.false;
      expect(await templateRegistry.activeTemplateCount()).to.equal(0);
    });

    it("Should emit TemplateDeactivated event", async function () {
      await expect(templateRegistry.connect(admin).deactivateTemplate(1))
        .to.emit(templateRegistry, "TemplateDeactivated")
        .withArgs(1);
    });

    it("Should reactivate a template", async function () {
      await templateRegistry.connect(admin).deactivateTemplate(1);
      await templateRegistry.connect(admin).reactivateTemplate(1);

      const [exists, active] = await templateRegistry.isTemplateActive(1);
      expect(exists).to.be.true;
      expect(active).to.be.true;
      expect(await templateRegistry.activeTemplateCount()).to.equal(1);
    });

    it("Should emit TemplateReactivated event", async function () {
      await templateRegistry.connect(admin).deactivateTemplate(1);
      await expect(templateRegistry.connect(admin).reactivateTemplate(1))
        .to.emit(templateRegistry, "TemplateReactivated")
        .withArgs(1);
    });

    it("Should reject deactivating already inactive template", async function () {
      await templateRegistry.connect(admin).deactivateTemplate(1);
      await expect(
        templateRegistry.connect(admin).deactivateTemplate(1)
      ).to.be.revertedWith("Template already inactive");
    });

    it("Should reject reactivating already active template", async function () {
      await expect(
        templateRegistry.connect(admin).reactivateTemplate(1)
      ).to.be.revertedWith("Template already active");
    });
  });

  describe("Usage Recording", function () {
    beforeEach(async function () {
      await templateRegistry.connect(admin).registerTemplate(
        templateHash,
        metadata,
        arbitrator.address,
        Category.Service
      );
    });

    it("Should record template usage", async function () {
      await templateRegistry.recordUsage(1);

      const template = await templateRegistry.getTemplate(1);
      expect(template.usageCount).to.equal(1);
    });

    it("Should emit TemplateUsed event", async function () {
      await expect(templateRegistry.recordUsage(1))
        .to.emit(templateRegistry, "TemplateUsed")
        .withArgs(1);
    });

    it("Should reject usage of inactive template", async function () {
      await templateRegistry.connect(admin).deactivateTemplate(1);
      await expect(templateRegistry.recordUsage(1))
        .to.be.revertedWith("Template is not active");
    });

    it("Should reject usage of non-existent template", async function () {
      await expect(templateRegistry.recordUsage(999))
        .to.be.revertedWith("Template does not exist");
    });
  });

  describe("Listing Templates", function () {
    beforeEach(async function () {
      // Register templates of different categories
      await templateRegistry.connect(admin).registerTemplate(
        templateHash,
        "ipfs://service1",
        arbitrator.address,
        Category.Service
      );
      await templateRegistry.connect(admin).registerTemplate(
        ethers.keccak256(ethers.toUtf8Bytes("sale")),
        "ipfs://sale1",
        arbitrator.address,
        Category.Sale
      );
      await templateRegistry.connect(admin).registerTemplate(
        ethers.keccak256(ethers.toUtf8Bytes("service2")),
        "ipfs://service2",
        arbitrator.address,
        Category.Service
      );
    });

    it("Should list all active templates", async function () {
      const templates = await templateRegistry.listTemplates();
      expect(templates.length).to.equal(3);
    });

    it("Should list templates by category", async function () {
      const serviceTemplates = await templateRegistry.listTemplatesByCategory(Category.Service);
      expect(serviceTemplates.length).to.equal(2);

      const saleTemplates = await templateRegistry.listTemplatesByCategory(Category.Sale);
      expect(saleTemplates.length).to.equal(1);
    });

    it("Should not include deactivated templates in list", async function () {
      await templateRegistry.connect(admin).deactivateTemplate(1);

      const templates = await templateRegistry.listTemplates();
      expect(templates.length).to.equal(2);
    });

    it("Should return empty array for category with no templates", async function () {
      const loanTemplates = await templateRegistry.listTemplatesByCategory(Category.Loan);
      expect(loanTemplates.length).to.equal(0);
    });
  });

  describe("View Functions", function () {
    it("Should return correct active status", async function () {
      await templateRegistry.connect(admin).registerTemplate(
        templateHash,
        metadata,
        arbitrator.address,
        Category.Service
      );

      let [exists, active] = await templateRegistry.isTemplateActive(1);
      expect(exists).to.be.true;
      expect(active).to.be.true;

      [exists, active] = await templateRegistry.isTemplateActive(999);
      expect(exists).to.be.false;
      expect(active).to.be.false;
    });

    it("Should revert getTemplate for non-existent template", async function () {
      await expect(templateRegistry.getTemplate(999))
        .to.be.revertedWith("Template does not exist");
    });
  });
});
