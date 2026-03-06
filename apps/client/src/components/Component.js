/**
 * Base Component class
 * All entity components should extend this
 */
export class Component {
    /**
     * Create a new component
     * @param {string} type - The component type identifier
     */
    constructor(type) {
        this.type = type;
        this.entity = null;
        this.dependencies = []; // Components this component depends on
        this.optional = []; // Optional components that enhance functionality if present
    }

    /**
     * Define a required dependency on another component type
     * @param {string} componentType - The required component type
     * @returns {Component} - Returns this for chaining
     */
    requireComponent(componentType) {
        this.dependencies.push(componentType);
        return this;
    }

    /**
     * Define an optional dependency on another component type
     * @param {string} componentType - The optional component type
     * @returns {Component} - Returns this for chaining
     */
    optionalComponent(componentType) {
        this.optional.push(componentType);
        return this;
    }

    /**
     * Check if all dependencies are satisfied for this component
     * @returns {boolean} - True if all dependencies are satisfied
     */
    areDependenciesSatisfied() {
        if (!this.entity) return false;

        for (const dependency of this.dependencies) {
            if (!this.entity.hasComponent(dependency)) {
                console.error(`Component ${this.type} requires ${dependency}, but it's missing from entity ${this.entity.id}`);
                return false;
            }
        }

        return true;
    }

    /**
     * Get a required dependency component
     * @param {string} type - Component type
     * @returns {Component} - The component if found, otherwise logs error
     */
    getRequiredComponent(type) {
        const component = this.entity.getComponent(type);
        if (!component) {
            console.error(`Required component ${type} not found for ${this.type} on entity ${this.entity.id}`);
        }
        return component;
    }

    /**
     * Get an optional dependency component
     * @param {string} type - Component type
     * @returns {Component|null} - The component if found, otherwise null
     */
    getOptionalComponent(type) {
        return this.entity.getComponent(type);
    }

    /**
     * Called when the component is attached to an entity
     * @returns {boolean} - True if initialization succeeded
     */
    onAttach() {
        // Check dependencies
        return this.areDependenciesSatisfied();
    }

    /**
     * Called when the component is detached from an entity
     */
    onDetach() {
        // Base implementation does nothing
    }

    /**
     * Update the component
     * @param {number} deltaTime - Time in ms since last update
     */
    update(deltaTime) {
        // Base implementation does nothing
    }
}