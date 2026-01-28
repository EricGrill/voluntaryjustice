import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { mainnet, sepolia, arbitrum, optimism, base, hardhat } from "wagmi/chains";

export const config = getDefaultConfig({
  appName: "VoluntaryJustice",
  projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "demo",
  chains: [
    sepolia,
    mainnet,
    arbitrum,
    optimism,
    base,
    hardhat,
  ],
  transports: {
    [hardhat.id]: http("http://127.0.0.1:8545"),
    [sepolia.id]: http(),
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [base.id]: http(),
  },
  ssr: true,
});
