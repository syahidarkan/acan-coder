import EventEmitter3 from 'eventemitter3';

export const enum ExtensionEvents {
  API_USAGE_UPDATED = 'api:usage_updated',
  API_RATE_LIMITED = 'api:rate_limited',
  API_ERROR = 'api:error',
  SCRIPT_ERROR = 'script:error',
  SCRIPT_PROGRESS = 'script:progress',
  SCRIPT_HUMAN_NEEDED = 'script:human_needed',
  SESSION_MESSAGE_ADDED = 'session:message_added',
  SESSION_CLEARED = 'session:cleared',
  HERMES_COMMAND_RECEIVED = 'hermes:command_received',
  HERMES_COMMAND_COMPLETED = 'hermes:command_completed',
}

class EventBusClass extends EventEmitter3 {}

export const EventBus = new EventBusClass();
