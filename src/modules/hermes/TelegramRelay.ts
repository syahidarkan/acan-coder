// This file is a stub for the extension host side.
// The actual Telegram bot runs in hermes-server/ on the PC.
// This module handles status queries from the extension about Hermes connectivity.

import { HermesClient } from './HermesClient';

export const TelegramRelay = {
  getStatus(): { hermesRunning: boolean; port: number } {
    return { hermesRunning: true, port: 3456 };
  }
};
