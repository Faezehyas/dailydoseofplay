/* @ts-self-types="./cards_play.d.ts" */

export class AccumulateReveals {
    static __wrap(ptr) {
        const obj = Object.create(AccumulateReveals.prototype);
        obj.__wbg_ptr = ptr;
        AccumulateRevealsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AccumulateRevealsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_accumulatereveals_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} reveal_message
     */
    add_reveal(reveal_message) {
        const ptr0 = passArray8ToWasm0(reveal_message, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.accumulatereveals_add_reveal(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Unmask the card (once all reveals are accumulated) and return its deck position.
     * @returns {number}
     */
    completed_position() {
        const ret = wasm.accumulatereveals_completed_position(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {Uint8Array} selfy
     * @returns {AccumulateReveals}
     */
    static deserialize(selfy) {
        const ptr0 = passArray8ToWasm0(selfy, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.accumulatereveals_deserialize(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return AccumulateReveals.__wrap(ret[0]);
    }
    /**
     * @returns {boolean}
     */
    is_completed() {
        const ret = wasm.accumulatereveals_is_completed(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {PlayerKeypair} sk
     * @returns {Uint8Array}
     */
    prove_reveal(sk) {
        _assertClass(sk, PlayerKeypair);
        const ret = wasm.accumulatereveals_prove_reveal(this.__wbg_ptr, sk.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    serialize() {
        const ret = wasm.accumulatereveals_serialize(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) AccumulateReveals.prototype[Symbol.dispose] = AccumulateReveals.prototype.free;

export class AccumulateShuffles {
    static __wrap(ptr) {
        const obj = Object.create(AccumulateShuffles.prototype);
        obj.__wbg_ptr = ptr;
        AccumulateShufflesFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AccumulateShufflesFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_accumulateshuffles_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} shuffle
     * @returns {number | undefined}
     */
    apply_shuffle(shuffle) {
        const ptr0 = passArray8ToWasm0(shuffle, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.accumulateshuffles_apply_shuffle(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] === Number.MAX_SAFE_INTEGER ? undefined : ret[0];
    }
    /**
     * @param {Uint8Array} selfy
     * @returns {AccumulateShuffles}
     */
    static deserialize(selfy) {
        const ptr0 = passArray8ToWasm0(selfy, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.accumulateshuffles_deserialize(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return AccumulateShuffles.__wrap(ret[0]);
    }
    /**
     * @param {PlayerKeypair} sk
     * @returns {Uint8Array}
     */
    do_shuffle(sk) {
        _assertClass(sk, PlayerKeypair);
        const ret = wasm.accumulateshuffles_do_shuffle(this.__wbg_ptr, sk.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {boolean}
     */
    is_completed() {
        const ret = wasm.accumulateshuffles_is_completed(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Always returns zero if more than 32 players
     * @returns {number}
     */
    remaining_mask() {
        const ret = wasm.accumulateshuffles_remaining_mask(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Uint8Array}
     */
    serialize() {
        const ret = wasm.accumulateshuffles_serialize(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) AccumulateShuffles.prototype[Symbol.dispose] = AccumulateShuffles.prototype.free;

export class AggregatedPublicKeys {
    static __wrap(ptr) {
        const obj = Object.create(AggregatedPublicKeys.prototype);
        obj.__wbg_ptr = ptr;
        AggregatedPublicKeysFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AggregatedPublicKeysFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_aggregatedpublickeys_free(ptr, 0);
    }
    /**
     * Create an `AccumulateReveals` for a single masked card.
     * Feed `RevealMessage`s into it via `add_reveal_wasm`, then call `completed_position`.
     * @param {Uint8Array} masked_card_bytes
     * @returns {AccumulateReveals}
     */
    accumulate_reveals(masked_card_bytes) {
        const ptr0 = passArray8ToWasm0(masked_card_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.aggregatedpublickeys_accumulate_reveals(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return AccumulateReveals.__wrap(ret[0]);
    }
    /**
     * @param {MaskedCards} deck
     * @returns {AccumulateShuffles}
     */
    accumulate_shuffles(deck) {
        const ptr = this.__destroy_into_raw();
        _assertClass(deck, MaskedCards);
        var ptr0 = deck.__destroy_into_raw();
        const ret = wasm.aggregatedpublickeys_accumulate_shuffles(ptr, ptr0);
        return AccumulateShuffles.__wrap(ret);
    }
    /**
     * Build AggregatedPublicKeys from player hellos.
     * `hellos_and_names` is a flat buffer: [num_players: u32 LE, then for each:
     *   hello_len: u32 LE, hello_bytes, name_len: u32 LE, name_bytes]
     * @param {Uint8Array} hellos_and_names
     * @returns {AggregatedPublicKeys}
     */
    static buildFromHellos(hellos_and_names) {
        const ptr0 = passArray8ToWasm0(hellos_and_names, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.aggregatedpublickeys_buildFromHellos(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return AggregatedPublicKeys.__wrap(ret[0]);
    }
    /**
     * @param {Uint8Array} selfy
     * @returns {AggregatedPublicKeys}
     */
    static deserialize(selfy) {
        const ptr0 = passArray8ToWasm0(selfy, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.aggregatedpublickeys_deserialize(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return AggregatedPublicKeys.__wrap(ret[0]);
    }
    /**
     * @returns {Uint8Array}
     */
    serialize() {
        const ret = wasm.aggregatedpublickeys_serialize(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {PlayerKeypair} sk
     * @param {MaskedCards} deck
     * @returns {Uint8Array}
     */
    shuffle_and_remask(sk, deck) {
        _assertClass(sk, PlayerKeypair);
        _assertClass(deck, MaskedCards);
        const ret = wasm.aggregatedpublickeys_shuffle_and_remask(this.__wbg_ptr, sk.__wbg_ptr, deck.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {number} idx
     * @param {MaskedCards} original_deck
     * @param {Uint8Array} shuffle_message
     * @returns {MaskedCards}
     */
    verify_shuffle(idx, original_deck, shuffle_message) {
        _assertClass(original_deck, MaskedCards);
        const ptr0 = passArray8ToWasm0(shuffle_message, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.aggregatedpublickeys_verify_shuffle(this.__wbg_ptr, idx, original_deck.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return MaskedCards.__wrap(ret[0]);
    }
}
if (Symbol.dispose) AggregatedPublicKeys.prototype[Symbol.dispose] = AggregatedPublicKeys.prototype.free;

export class CardsError {
    static __wrap(ptr) {
        const obj = Object.create(CardsError.prototype);
        obj.__wbg_ptr = ptr;
        CardsErrorFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CardsErrorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_cardserror_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    as_js_error() {
        const ret = wasm.cardserror_as_js_error(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) CardsError.prototype[Symbol.dispose] = CardsError.prototype.free;

export class MaskedCards {
    static __wrap(ptr) {
        const obj = Object.create(MaskedCards.prototype);
        obj.__wbg_ptr = ptr;
        MaskedCardsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MaskedCardsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_maskedcards_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} bytes
     * @returns {MaskedCards}
     */
    static deserialize(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.maskedcards_deserialize(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return MaskedCards.__wrap(ret[0]);
    }
    /**
     * @param {number} index
     * @returns {Uint8Array}
     */
    get_card(index) {
        const ret = wasm.maskedcards_get_card(this.__wbg_ptr, index);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {number}
     */
    len() {
        const ret = wasm.maskedcards_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Uint8Array}
     */
    serialize() {
        const ret = wasm.maskedcards_serialize(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) MaskedCards.prototype[Symbol.dispose] = MaskedCards.prototype.free;

export class PlayerKeypair {
    static __wrap(ptr) {
        const obj = Object.create(PlayerKeypair.prototype);
        obj.__wbg_ptr = ptr;
        PlayerKeypairFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PlayerKeypairFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_playerkeypair_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} selfy
     * @returns {PlayerKeypair}
     */
    static deserialize(selfy) {
        const ptr0 = passArray8ToWasm0(selfy, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.playerkeypair_deserialize(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return PlayerKeypair.__wrap(ret[0]);
    }
    constructor() {
        const ret = wasm.playerkeypair_player_keygen();
        this.__wbg_ptr = ret;
        PlayerKeypairFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Include any delegating public key in `player_public_info` for back certification
     * @param {Uint8Array} player_public_info
     * @returns {Uint8Array}
     */
    prove_player(player_public_info) {
        const ptr0 = passArray8ToWasm0(player_public_info, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.playerkeypair_prove_player(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Produce a `RevealMessage` (reveal token + ZK proof) for a single masked card.
     * @param {Uint8Array} masked_card_bytes
     * @returns {Uint8Array}
     */
    prove_reveal(masked_card_bytes) {
        const ptr0 = passArray8ToWasm0(masked_card_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.playerkeypair_prove_reveal(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Warning: Never send this off the machine
     * @returns {Uint8Array}
     */
    serialize() {
        const ret = wasm.playerkeypair_serialize(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) PlayerKeypair.prototype[Symbol.dispose] = PlayerKeypair.prototype.free;

/**
 * Assumes correct format and returns empty string if not.
 * @param {Uint8Array} pk
 * @returns {Uint8Array}
 */
export function player_public(pk) {
    const ptr0 = passArray8ToWasm0(pk, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.player_public(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} pk
 * @param {Uint8Array} player_public_info
 * @returns {Uint8Array}
 */
export function verify_player(pk, player_public_info) {
    const ptr0 = passArray8ToWasm0(pk, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(player_public_info, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.verify_player(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @returns {MaskedCards}
 */
export function zero_mask_deck() {
    const ret = wasm.zero_mask_deck();
    return MaskedCards.__wrap(ret);
}

/**
 * @param {number} count
 * @returns {MaskedCards}
 */
export function zero_mask_deck_n(count) {
    const ret = wasm.zero_mask_deck_n(count);
    return MaskedCards.__wrap(ret);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_30c8987f7c2ed4e2: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_is_function_1f9d30630b8b1d3d: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_3c45d4f2dde4e749: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_90b56bc79aad6f6c: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_8865fb403f8fe9d8: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_187d372bd5fdd4aa: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_cardserror_new: function(arg0) {
            const ret = CardsError.__wrap(arg0);
            return ret;
        },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_length_7f3c00c40364105e: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_with_length_3da0ad195f6f63ba: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_bc27214492979395: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_static_accessor_GLOBAL_266715b9d96ba635: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_10fb7dc1ae063179: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_0b583911f537483a: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_d7f903d1508cbdc4: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_002b94d5e13d1411: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./cards_play_bg.js": import0,
    };
}

const AccumulateRevealsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_accumulatereveals_free(ptr, 1));
const AccumulateShufflesFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_accumulateshuffles_free(ptr, 1));
const AggregatedPublicKeysFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_aggregatedpublickeys_free(ptr, 1));
const CardsErrorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_cardserror_free(ptr, 1));
const MaskedCardsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_maskedcards_free(ptr, 1));
const PlayerKeypairFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_playerkeypair_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('cards_play_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
