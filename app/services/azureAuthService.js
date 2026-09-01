const { ConfidentialClientApplication } = require("@azure/msal-node");
const { config } = require("../config/config");

/**
 * Azure MSAL Authentication Service
 * Handles Microsoft Azure authentication using MSAL
 */

class AzureAuthService {
  constructor() {
    this.authority = `https://login.microsoftonline.com/${config.azure.auth.tenantId}`;
    this.clientApp = null;
    this.tokenRequest = {
      scopes: config.azure.auth.scope,
    };

    this.initializeClient();
  }

  /**
   * Initialize the MSAL client application
   */
  initializeClient() {
    const msalConfig = {
      auth: {
        clientId: config.azure.auth.clientId,
        authority: this.authority,
        clientSecret: config.azure.auth.clientSecret,
      },
    };

    this.clientApp = new ConfidentialClientApplication(msalConfig);
    console.log("✓ Azure MSAL client initialized");
  }

  /**
   * Acquire access token using client credentials flow
   * @returns {Promise<string|null>} Access token or null if failed
   */
  async getAccessToken() {
    try {
      const result = await this.clientApp.acquireTokenByClientCredential(
        this.tokenRequest
      );

      if (result && result.accessToken) {
        console.log("✓ Azure access token acquired successfully");
        // Don't log the actual token for security reasons
        return result.accessToken;
      } else {
        console.log("No access token returned");
        return null;
      }
    } catch (error) {
      console.error("Error acquiring Azure access token:", error.message);
      return null;
    }
  }

  /**
   * Initialize authentication and acquire initial token
   */
  async initialize() {
    console.log("Initializing Azure authentication...");
    const token = await this.getAccessToken();
    return token !== null;
  }
}

// Create singleton instance
const azureAuthService = new AzureAuthService();

module.exports = azureAuthService;
