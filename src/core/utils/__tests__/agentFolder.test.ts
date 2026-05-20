/**
 * agentFolder.ts unit tests for FEAT-29-01 Task 1.
 *
 * Covers the sub-folder helpers introduced by ADR-119 third iteration:
 *  - getAgentDataDir returns {root}/data
 *  - getAgentCacheDir returns {root}/cache
 *  - both respect the configured agentFolderPath setting
 *  - both fall back to DEFAULT_AGENT_FOLDER when setting is empty
 *  - both fall back to DEFAULT_AGENT_FOLDER when setting is an absolute path
 *    (because data and cache go through the vault adapter, which cannot reach
 *    absolute paths)
 *  - existing helpers (getInternalAgentFolderPath, getTmpRoot, etc) keep
 *    their semantics for the migration window
 */

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_AGENT_FOLDER,
    getAgentDataDir,
    getAgentCacheDir,
    getInternalAgentFolderPath,
    getTmpRoot,
    getPluginSkillsDir,
    getPluginSkillsPath,
    getVaultDnaPath,
    getSelfAuthoredSkillsDir,
    isAbsoluteAgentFolder,
} from '../agentFolder';
import type { ObsidianAgentSettings } from '../../../types/settings';

type Holder = {
    settings: {
        agentFolderPath?: string;
        _layoutMigrationStatus?: ObsidianAgentSettings['_layoutMigrationStatus'];
    };
};

describe('agentFolder sub-folder helpers (FEAT-29-01)', () => {
    it('getAgentDataDir returns {root}/data for configured vault-relative path', () => {
        const holder: Holder = { settings: { agentFolderPath: '.vault-operator' } };
        expect(getAgentDataDir(holder)).toBe('.vault-operator/data');
    });

    it('getAgentCacheDir returns {root}/cache for configured vault-relative path', () => {
        const holder: Holder = { settings: { agentFolderPath: '.vault-operator' } };
        expect(getAgentCacheDir(holder)).toBe('.vault-operator/cache');
    });

    it('getAgentDataDir falls back to DEFAULT_AGENT_FOLDER when setting is empty', () => {
        const holder: Holder = { settings: { agentFolderPath: '' } };
        expect(getAgentDataDir(holder)).toBe(`${DEFAULT_AGENT_FOLDER}/data`);
    });

    it('getAgentCacheDir falls back to DEFAULT_AGENT_FOLDER when setting is empty', () => {
        const holder: Holder = { settings: { agentFolderPath: '' } };
        expect(getAgentCacheDir(holder)).toBe(`${DEFAULT_AGENT_FOLDER}/cache`);
    });

    it('getAgentDataDir uses DEFAULT_AGENT_FOLDER when setting is absolute', () => {
        const holder: Holder = { settings: { agentFolderPath: '/Users/seb/external-folder' } };
        expect(isAbsoluteAgentFolder('/Users/seb/external-folder')).toBe(true);
        expect(getAgentDataDir(holder)).toBe(`${DEFAULT_AGENT_FOLDER}/data`);
    });

    it('getAgentCacheDir uses DEFAULT_AGENT_FOLDER when setting is absolute', () => {
        const holder: Holder = { settings: { agentFolderPath: 'C:\\Users\\seb\\external-folder' } };
        expect(isAbsoluteAgentFolder('C:\\Users\\seb\\external-folder')).toBe(true);
        expect(getAgentCacheDir(holder)).toBe(`${DEFAULT_AGENT_FOLDER}/cache`);
    });

    it('getAgentDataDir handles custom vault-relative agent folder', () => {
        const holder: Holder = { settings: { agentFolderPath: 'CustomPlugin' } };
        expect(getAgentDataDir(holder)).toBe('CustomPlugin/data');
    });

    it('getAgentCacheDir handles custom vault-relative agent folder', () => {
        const holder: Holder = { settings: { agentFolderPath: 'CustomPlugin' } };
        expect(getAgentCacheDir(holder)).toBe('CustomPlugin/cache');
    });

    it('does not break existing helpers (getInternalAgentFolderPath returns root unchanged)', () => {
        const holder: Holder = { settings: { agentFolderPath: '.vault-operator' } };
        expect(getInternalAgentFolderPath(holder)).toBe('.vault-operator');
    });

    it('does not break existing helpers (getTmpRoot legacy layout)', () => {
        const holder: Holder = { settings: { agentFolderPath: '.vault-operator' } };
        // Before migration: legacy flat layout
        expect(getTmpRoot(holder)).toBe('.vault-operator/tmp');
    });
});

describe('agentFolder layout-aware helpers (FEAT-29-01 post-migration)', () => {
    it('getPluginSkillsDir uses data/ when migration is complete', () => {
        const holder: Holder = {
            settings: { agentFolderPath: '.vault-operator', _layoutMigrationStatus: 'complete' },
        };
        expect(getPluginSkillsDir(holder)).toBe('.vault-operator/data/plugin-skills');
    });

    it('getPluginSkillsDir keeps legacy flat layout when migration is pending', () => {
        const holder: Holder = {
            settings: { agentFolderPath: '.obsilo-vault', _layoutMigrationStatus: 'pending' },
        };
        expect(getPluginSkillsDir(holder)).toBe('.obsilo-vault/plugin-skills');
    });

    it('getPluginSkillsDir keeps legacy when status is undefined (fresh install)', () => {
        const holder: Holder = { settings: { agentFolderPath: '.vault-operator' } };
        expect(getPluginSkillsDir(holder)).toBe('.vault-operator/plugin-skills');
    });

    it('getPluginSkillsPath includes data/ sub-folder when migrated', () => {
        const holder: Holder = {
            settings: { agentFolderPath: '.vault-operator', _layoutMigrationStatus: 'complete' },
        };
        expect(getPluginSkillsPath(holder, 'excalidraw')).toBe(
            '.vault-operator/data/plugin-skills/excalidraw.skill.md',
        );
    });

    it('getVaultDnaPath moves into data/ when migrated', () => {
        const holder: Holder = {
            settings: { agentFolderPath: '.vault-operator', _layoutMigrationStatus: 'complete' },
        };
        expect(getVaultDnaPath(holder)).toBe('.vault-operator/data/vault-dna.json');
    });

    it('getTmpRoot moves into cache/ when migrated', () => {
        const holder: Holder = {
            settings: { agentFolderPath: '.vault-operator', _layoutMigrationStatus: 'complete' },
        };
        expect(getTmpRoot(holder)).toBe('.vault-operator/cache/tmp');
    });

    it('getSelfAuthoredSkillsDir moves into data/ when migrated', () => {
        const holder: Holder = {
            settings: { agentFolderPath: '.vault-operator', _layoutMigrationStatus: 'complete' },
        };
        expect(getSelfAuthoredSkillsDir(holder)).toBe('.vault-operator/data/skills');
    });

    it('mid-state status (e.g. data-vault-done) does NOT switch helpers yet', () => {
        // Only "complete" flips the layout. Mid-state means migration is still
        // running, so we use the legacy paths and let the migration finish.
        const holder: Holder = {
            settings: { agentFolderPath: '.vault-operator', _layoutMigrationStatus: 'data-vault-done' },
        };
        expect(getPluginSkillsDir(holder)).toBe('.vault-operator/plugin-skills');
        expect(getTmpRoot(holder)).toBe('.vault-operator/tmp');
    });
});
