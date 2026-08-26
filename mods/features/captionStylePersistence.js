import { configRead, configWrite, configChangeEmitter } from '../config.js';

const SELECTORS = {
    PLAYER: '.html5-video-player',
};

const EVENTS = {
    YT_STATE_CHANGE: 'onStateChange',
    YT_CAPTIONS_SETTINGS_CHANGED: 'captionssettingschanged',
    YT_CAPTIONS_CHANGED: 'captionschanged',
    YT_CAPTIONS_TRACKLIST_CHANGED: 'onCaptionsTrackListChanged',
    CONFIG_CHANGE: 'configChange',
};

const CONFIG_KEYS = {
    ENABLED: 'enableCaptionStylePersistence',
    STYLE: 'captionStyleSettings',
    CAPTIONS_ON: 'captionsEnabled',
    RAW_BACKUPS: 'captionRawKeyBackups',
};

const YT_KEYS = [
    'yt-player-caption-display-settings',
    'yt-player-sticky-caption',
    'yt-player-caption-sticky-language',
];

const PLAYER_STATES = {
    PLAYING: 1,
    PAUSED: 2,
};

const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 500;
const APPLY_RETRY_MS = 500;
const APPLY_MAX_ATTEMPTS = 20;

function restoreAndRefreshRawKeys() {
    if (!configRead(CONFIG_KEYS.ENABLED)) return;

    const backups = configRead(CONFIG_KEYS.RAW_BACKUPS) || {};
    let backupsChanged = false;

    for (const key of YT_KEYS) {
        try {
            const stored = localStorage[key];
            if (stored) {
                const wrapper = JSON.parse(stored);
                if (backups[key] !== wrapper.data) {
                    backups[key] = wrapper.data;
                    backupsChanged = true;
                }
                localStorage[key] = JSON.stringify({ data: wrapper.data, expiration: Date.now() + FAR_FUTURE_MS, creation: Date.now() });
            } else if (backups[key] !== undefined) {
                localStorage[key] = JSON.stringify({ data: backups[key], expiration: Date.now() + FAR_FUTURE_MS, creation: Date.now() });
            }
        } catch (e) {
            console.warn('[CaptionStyle] Failed to refresh key', key, e);
        }
    }

    if (backupsChanged) configWrite(CONFIG_KEYS.RAW_BACKUPS, backups);
}

class CaptionStyleHandler {
    #player = null;
    #attachTimeout = null;
    #saveTimeout = null;
    #applyTimeout = null;
    #applyAttempts = 0;
    #hasAppliedStyle = false;
    #lastVideoId = null;
    #captionsRestored = false;

    constructor() {
        this.init();
    }

    init() {
        this.#pollForPlayer();
        this.#setupConfigListener();
    }

    #pollForPlayer() {
        clearTimeout(this.#attachTimeout);

        const playerElement = document.querySelector(SELECTORS.PLAYER);

        if (!playerElement) {
            this.#attachTimeout = setTimeout(() => this.#pollForPlayer(), 500);
            return;
        }

        this.#player = playerElement;

        this.#player.addEventListener(EVENTS.YT_CAPTIONS_SETTINGS_CHANGED, this.#handleSettingsChanged);
        this.#player.addEventListener(EVENTS.YT_CAPTIONS_CHANGED, this.#handleCaptionsChanged);
        this.#player.addEventListener(EVENTS.YT_CAPTIONS_TRACKLIST_CHANGED, this.#handleTrackListChanged);
        this.#player.addEventListener(EVENTS.YT_STATE_CHANGE, this.#handleStateChange);

        this.#tryApplyStyle();
    }

    #setupConfigListener() {
        configChangeEmitter.addEventListener(EVENTS.CONFIG_CHANGE, (ev) => {
            if (ev.detail?.key === CONFIG_KEYS.ENABLED && ev.detail?.value) {
                restoreAndRefreshRawKeys();
                this.#hasAppliedStyle = false;
                this.#applyAttempts = 0;
                this.#captionsRestored = false;
                this.#tryApplyStyle();
                this.#tryRestoreCaptions();
            }
        });
    }

    #handleSettingsChanged = () => {
        clearTimeout(this.#saveTimeout);
        this.#saveTimeout = setTimeout(() => this.#saveStyle(), SAVE_DEBOUNCE_MS);
    };

    #handleCaptionsChanged = () => {
        this.#saveCaptionsEnabled();
    };

    #handleTrackListChanged = () => {
        this.#applyAttempts = 0;
        this.#tryApplyStyle();
        this.#tryRestoreCaptions();
    };

    #handleStateChange = () => {
        const state = this.#player?.getPlayerStateObject?.();
        const videoId = this.#player?.getVideoData?.()?.video_id;

        if (videoId !== this.#lastVideoId) {
            this.#lastVideoId = videoId;
            this.#captionsRestored = false;
        }

        if (state?.isPlaying) {
            this.#tryApplyStyle();
            this.#tryRestoreCaptions();
            if (this.#captionsRestored) this.#saveCaptionsEnabled();
        }
    };

    #getTracklist() {
        try {
            const tracklist = this.#player?.getOption?.('captions', 'tracklist');
            if (Array.isArray(tracklist) && tracklist.length) return tracklist;
            const captionTracks = this.#player?.getPlayerResponse?.()?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            return Array.isArray(captionTracks) ? captionTracks : [];
        } catch (e) {
            return [];
        }
    }

    #isPlaybackActive() {
        try {
            const state = this.#player.getPlayerState();
            return state === PLAYER_STATES.PLAYING || state === PLAYER_STATES.PAUSED;
        } catch (e) {
            return false;
        }
    }

    #saveStyle() {
        if (!configRead(CONFIG_KEYS.ENABLED)) return;

        const settings = this.#player?.getSubtitlesUserSettings?.();
        if (!settings) return;

        if (JSON.stringify(settings) !== JSON.stringify(configRead(CONFIG_KEYS.STYLE))) {
            configWrite(CONFIG_KEYS.STYLE, JSON.parse(JSON.stringify(settings)));
        }
        restoreAndRefreshRawKeys();
    }

    #saveCaptionsEnabled() {
        if (!configRead(CONFIG_KEYS.ENABLED)) return;
        if (!this.#getTracklist().length) return;

        let captionsOn;
        try {
            captionsOn = this.#player.isSubtitlesOn();
        } catch (e) {
            return;
        }
        if (typeof captionsOn !== 'boolean') return;
        if (!captionsOn && !this.#isPlaybackActive()) return;

        if (captionsOn !== configRead(CONFIG_KEYS.CAPTIONS_ON)) {
            configWrite(CONFIG_KEYS.CAPTIONS_ON, captionsOn);
        }
    }

    #tryRestoreCaptions() {
        if (this.#captionsRestored || !configRead(CONFIG_KEYS.ENABLED)) return;

        if (configRead(CONFIG_KEYS.CAPTIONS_ON) !== true) {
            this.#captionsRestored = true;
            return;
        }

        if (!this.#getTracklist().length) return;

        this.#captionsRestored = true;

        setTimeout(() => {
            try {
                if (!this.#player.isSubtitlesOn()) this.#player.toggleSubtitlesOn();
            } catch (e) {
                console.warn('[CaptionStyle] Failed to restore captions:', e);
            }
        }, 0);
    }

    #tryApplyStyle = () => {
        clearTimeout(this.#applyTimeout);

        if (this.#hasAppliedStyle || !configRead(CONFIG_KEYS.ENABLED)) return;

        const savedStyle = configRead(CONFIG_KEYS.STYLE);
        if (!savedStyle) return;

        const settings = this.#player?.getSubtitlesUserSettings?.();
        if (!settings) {
            if (this.#applyAttempts < APPLY_MAX_ATTEMPTS) {
                this.#applyAttempts++;
                this.#applyTimeout = setTimeout(this.#tryApplyStyle, APPLY_RETRY_MS);
            }
            return;
        }

        try {
            this.#player.updateSubtitlesUserSettings(JSON.parse(JSON.stringify(savedStyle)), true);
            this.#hasAppliedStyle = true;
        } catch (e) {
            console.warn('[CaptionStyle] Failed to apply caption style:', e);
        }
    };
}

restoreAndRefreshRawKeys();

window.captionStyleHandler = new CaptionStyleHandler();
