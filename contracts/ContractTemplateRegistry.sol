// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ContractTemplateRegistry
 * @dev Registry for contract templates that define rules, arbitration, and enforcement
 */
contract ContractTemplateRegistry is AccessControl {
    bytes32 public constant TEMPLATE_ADMIN_ROLE = keccak256("TEMPLATE_ADMIN_ROLE");

    enum TemplateCategory {
        Service,
        Sale,
        Loan,
        Employment,
        Escrow,
        Custom
    }

    struct TemplateInfo {
        uint256 id;
        bytes32 templateHash;
        string metadata; // IPFS hash or URI to full template
        address defaultArbitrator;
        TemplateCategory category;
        bool active;
        uint256 createdAt;
        uint256 usageCount;
    }

    mapping(uint256 => TemplateInfo) private _templates;
    uint256 private _templateCount;
    uint256[] private _activeTemplateIds;

    // Events
    event TemplateRegistered(
        uint256 indexed templateId,
        bytes32 templateHash,
        address defaultArbitrator,
        TemplateCategory category
    );
    event TemplateUpdated(uint256 indexed templateId, string metadata);
    event TemplateDeactivated(uint256 indexed templateId);
    event TemplateReactivated(uint256 indexed templateId);
    event TemplateUsed(uint256 indexed templateId);

    constructor(address defaultAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(TEMPLATE_ADMIN_ROLE, defaultAdmin);
    }

    /**
     * @dev Register a new contract template
     * @param templateHash Hash of the template content
     * @param metadata IPFS hash or URI to full template document
     * @param defaultArbitrator Default arbitrator for contracts using this template
     * @param category Template category
     * @return templateId The ID of the newly registered template
     */
    function registerTemplate(
        bytes32 templateHash,
        string calldata metadata,
        address defaultArbitrator,
        TemplateCategory category
    ) external onlyRole(TEMPLATE_ADMIN_ROLE) returns (uint256 templateId) {
        require(templateHash != bytes32(0), "Template hash required");
        require(bytes(metadata).length > 0, "Metadata required");
        require(defaultArbitrator != address(0), "Default arbitrator required");

        _templateCount++;
        templateId = _templateCount;

        _templates[templateId] = TemplateInfo({
            id: templateId,
            templateHash: templateHash,
            metadata: metadata,
            defaultArbitrator: defaultArbitrator,
            category: category,
            active: true,
            createdAt: block.timestamp,
            usageCount: 0
        });

        _activeTemplateIds.push(templateId);

        emit TemplateRegistered(templateId, templateHash, defaultArbitrator, category);
    }

    /**
     * @dev Update template metadata
     * @param templateId ID of the template to update
     * @param metadata New metadata URI
     */
    function updateMetadata(uint256 templateId, string calldata metadata)
        external
        onlyRole(TEMPLATE_ADMIN_ROLE)
    {
        require(_templates[templateId].id != 0, "Template does not exist");
        require(bytes(metadata).length > 0, "Metadata required");

        _templates[templateId].metadata = metadata;

        emit TemplateUpdated(templateId, metadata);
    }

    /**
     * @dev Update default arbitrator for a template
     * @param templateId ID of the template
     * @param newArbitrator New default arbitrator address
     */
    function updateDefaultArbitrator(uint256 templateId, address newArbitrator)
        external
        onlyRole(TEMPLATE_ADMIN_ROLE)
    {
        require(_templates[templateId].id != 0, "Template does not exist");
        require(newArbitrator != address(0), "Invalid arbitrator address");

        _templates[templateId].defaultArbitrator = newArbitrator;
    }

    /**
     * @dev Deactivate a template (cannot be used for new contracts)
     * @param templateId ID of the template to deactivate
     */
    function deactivateTemplate(uint256 templateId)
        external
        onlyRole(TEMPLATE_ADMIN_ROLE)
    {
        require(_templates[templateId].id != 0, "Template does not exist");
        require(_templates[templateId].active, "Template already inactive");

        _templates[templateId].active = false;

        // Remove from active list
        for (uint256 i = 0; i < _activeTemplateIds.length; i++) {
            if (_activeTemplateIds[i] == templateId) {
                _activeTemplateIds[i] = _activeTemplateIds[_activeTemplateIds.length - 1];
                _activeTemplateIds.pop();
                break;
            }
        }

        emit TemplateDeactivated(templateId);
    }

    /**
     * @dev Reactivate a deactivated template
     * @param templateId ID of the template to reactivate
     */
    function reactivateTemplate(uint256 templateId)
        external
        onlyRole(TEMPLATE_ADMIN_ROLE)
    {
        require(_templates[templateId].id != 0, "Template does not exist");
        require(!_templates[templateId].active, "Template already active");

        _templates[templateId].active = true;
        _activeTemplateIds.push(templateId);

        emit TemplateReactivated(templateId);
    }

    /**
     * @dev Increment usage count when template is used (called by ContractFactory)
     * @param templateId ID of the template being used
     */
    function recordUsage(uint256 templateId) external {
        require(_templates[templateId].id != 0, "Template does not exist");
        require(_templates[templateId].active, "Template is not active");

        _templates[templateId].usageCount++;

        emit TemplateUsed(templateId);
    }

    /**
     * @dev Get template information
     * @param templateId ID of the template
     * @return Template information
     */
    function getTemplate(uint256 templateId) external view returns (TemplateInfo memory) {
        require(_templates[templateId].id != 0, "Template does not exist");
        return _templates[templateId];
    }

    /**
     * @dev List all active templates
     * @return Array of active template information
     */
    function listTemplates() external view returns (TemplateInfo[] memory) {
        TemplateInfo[] memory templates = new TemplateInfo[](_activeTemplateIds.length);

        for (uint256 i = 0; i < _activeTemplateIds.length; i++) {
            templates[i] = _templates[_activeTemplateIds[i]];
        }

        return templates;
    }

    /**
     * @dev List templates by category
     * @param category Category to filter by
     * @return Array of template information
     */
    function listTemplatesByCategory(TemplateCategory category)
        external
        view
        returns (TemplateInfo[] memory)
    {
        // First count matching templates
        uint256 count = 0;
        for (uint256 i = 0; i < _activeTemplateIds.length; i++) {
            if (_templates[_activeTemplateIds[i]].category == category) {
                count++;
            }
        }

        // Then populate array
        TemplateInfo[] memory templates = new TemplateInfo[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < _activeTemplateIds.length; i++) {
            if (_templates[_activeTemplateIds[i]].category == category) {
                templates[index] = _templates[_activeTemplateIds[i]];
                index++;
            }
        }

        return templates;
    }

    /**
     * @dev Check if a template exists and is active
     * @param templateId ID of the template
     * @return exists Whether the template exists
     * @return active Whether the template is active
     */
    function isTemplateActive(uint256 templateId) external view returns (bool exists, bool active) {
        exists = _templates[templateId].id != 0;
        active = exists && _templates[templateId].active;
    }

    /**
     * @dev Get total number of templates (including inactive)
     * @return Total template count
     */
    function totalTemplates() external view returns (uint256) {
        return _templateCount;
    }

    /**
     * @dev Get number of active templates
     * @return Active template count
     */
    function activeTemplateCount() external view returns (uint256) {
        return _activeTemplateIds.length;
    }
}
