/**
 * A simple event bus to decouple game systems
 * This will facilitate network event handling in the future
 */
class EventBus {
    constructor() {
        this.listeners = {};
    }

    /**
     * Subscribe to an event
     * @param {string} event - The event name
     * @param {function} callback - The callback function
     * @returns {function} - Unsubscribe function
     */
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }

        this.listeners[event].push(callback);

        // Return unsubscribe function
        return () => {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        };
    }

    /**
     * Emit an event
     * @param {string} event - The event name
     * @param {object} data - The event data
     */
    emit(event, data) {
        // Add timestamp to all events - critical for multiplayer sync
        const eventData = {
            ...data,
            timestamp: Date.now()
        };

        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(eventData));
        }

        // Log events for debugging (would be helpful for network debugging)
        // console.log(`Event: ${event}`, eventData);
    }
}

// Create a global instance and export it
export const eventBus = new EventBus();