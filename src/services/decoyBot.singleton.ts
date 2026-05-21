import { DecoyBotService } from './decoyBot.service';

let _service: DecoyBotService | null = null;

export const setDecoyBotService = (s: DecoyBotService): void => { _service = s; };
export const getDecoyBotService = (): DecoyBotService | null => _service;
