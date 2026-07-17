pragma Singleton
import QtQuick

// Keeps each workspace selection independent while preserving the legacy
// activeIds list as a migration source for existing installations.
QtObject {
    function hasOwn(object, key) {
        return object !== null && object !== undefined
                && Object.prototype.hasOwnProperty.call(object, key)
    }

    function sanitizedIds(ids, allowedIds) {
        const allowed = {}
        for (const id of allowedIds || [])
            allowed[id] = true

        const result = []
        for (const id of ids || []) {
            if (allowed[id] === true && result.indexOf(id) < 0)
                result.push(id)
        }
        return result
    }

    function activeIds(config, mode, allowedIds) {
        const cfg = config || {}
        const byMode = cfg.modeActiveIds || {}
        if (hasOwn(byMode, mode))
            return sanitizedIds(byMode[mode] || [], allowedIds)

        const legacy = cfg.activeIds || []
        if (legacy.length === 0)
            return (allowedIds || []).slice()
        return sanitizedIds(legacy, allowedIds)
    }

    function initialize(config, allowedByMode) {
        const cfg = config || {}
        const existing = cfg.modeActiveIds || {}
        const initialized = {}

        for (const key in existing)
            initialized[key] = (existing[key] || []).slice()
        for (const mode in allowedByMode) {
            if (!hasOwn(initialized, mode))
                initialized[mode] = activeIds(cfg, mode, allowedByMode[mode])
            else
                initialized[mode] = sanitizedIds(initialized[mode], allowedByMode[mode])
        }
        cfg.modeActiveIds = initialized
        return cfg
    }
}
