function articleKey(item) {
    return String(item.link || item.id || "").split("#")[0];
}

function pressure(state, value, now, threshold, duration) {
    state = Object.assign({ active: false, since: 0, clearSince: 0 }, state || {});
    let fire = false;
    if (!isFinite(value)) return { state: {}, fire: false };
    if (!state.active) {
        state.clearSince = 0;
        state.since = value >= threshold ? (state.since || now) : 0;
        if (state.since && now - state.since >= duration) {
            state.active = true;
            fire = true;
        }
    } else {
        state.clearSince = value < threshold - 10 ? (state.clearSince || now) : 0;
        if (state.clearSince && now - state.clearSince >= 30000)
            state = { active: false, since: 0, clearSince: 0 };
    }
    return { state: state, fire: fire };
}

function consume(pending, included) {
    return pending.filter(function(item) { return included.indexOf(item.key) < 0; });
}
