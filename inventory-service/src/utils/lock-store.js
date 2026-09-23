const locks = new Map();

export const lockStore = {
    async set(key, value, mode, ttlMode, ttl) {
        if (mode === 'NX' && locks.has(key)) return null;

        locks.set(key, value);
        const ttlMs = ttlMode === 'PX' ? ttl : ttl * 1000;
        setTimeout(() => locks.delete(key), ttlMs).unref?.();
        return 'OK';
    },

    async del(key) {
        return locks.delete(key) ? 1 : 0;
    }
};
