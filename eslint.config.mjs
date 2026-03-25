import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    security.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            'no-unsanitized': noUnsanitized,
            obsidianmd,
        },
        rules: {
            // TypeScript
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { args: 'none' }],
            '@typescript-eslint/no-explicit-any': 'warn',
            'no-prototype-builtins': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            // TypeScript strict rules (matched to ObsidianReviewBot config)
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/require-await': 'error',
            '@typescript-eslint/no-deprecated': 'warn',
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
            // Security
            'security/detect-child-process': 'error',
            'security/detect-eval-with-expression': 'error',
            'security/detect-non-literal-fs-filename': 'warn',
            'security/detect-non-literal-regexp': 'warn',
            'security/detect-possible-timing-attacks': 'warn',
            'security/detect-object-injection': 'warn',
            'no-unsanitized/method': 'error',
            'no-unsanitized/property': 'error',
            // Obsidian Community Plugin Review-Bot Rules
            ...obsidianmd.configs.recommended,
            'obsidianmd/ui/sentence-case-locale-module': ['error', {
                enforceCamelCaseLower: true,
                brands: [
                    // Default brands (inherited manually since we override)
                    'iOS', 'iPadOS', 'macOS', 'Windows', 'Android', 'Linux',
                    'Obsidian', 'Obsidian Sync', 'Obsidian Publish',
                    'Google Drive', 'Dropbox', 'OneDrive', 'iCloud Drive',
                    'YouTube', 'Slack', 'Discord', 'Telegram', 'WhatsApp', 'Twitter', 'X',
                    'Readwise', 'Zotero', 'Excalidraw', 'Mermaid',
                    'Markdown', 'LaTeX', 'JavaScript', 'TypeScript', 'Node.js',
                    'npm', 'pnpm', 'Yarn', 'Git', 'GitHub', 'GitLab',
                    'Notion', 'Evernote', 'Roam Research', 'Logseq', 'Anki',
                    'Reddit', 'VS Code', 'Visual Studio Code',
                    'IntelliJ IDEA', 'WebStorm', 'PyCharm',
                    // Project-specific brands
                    'OpenAI', 'OpenRouter', 'LibreOffice', 'TaskNotes', 'VaultDNA',
                    'MetaEdit', 'HyDE', 'Azure', 'Python', 'cURL', 'Brave', 'Tavily',
                    'LM Studio', 'GPT-4o',
                ],
                acronyms: [
                    // Default acronyms (inherited manually since we override)
                    'API', 'HTTP', 'HTTPS', 'URL', 'DNS', 'TCP', 'IP', 'SSH', 'TLS', 'SSL', 'FTP', 'SFTP', 'SMTP',
                    'JSON', 'XML', 'HTML', 'CSS', 'PDF', 'CSV', 'YAML', 'SQL', 'PNG', 'JPG', 'JPEG', 'GIF', 'SVG',
                    '2FA', 'MFA', 'OAuth', 'JWT', 'LDAP', 'SAML',
                    'SDK', 'IDE', 'CLI', 'GUI', 'CRUD', 'REST', 'SOAP',
                    'CPU', 'GPU', 'RAM', 'SSD', 'USB', 'UI', 'OK',
                    'RSS', 'S3', 'WebDAV', 'ID', 'UUID', 'GUID', 'SHA', 'MD5',
                    'ASCII', 'UTF-8', 'UTF-16', 'DOM', 'CDN', 'FAQ', 'AI', 'ML',
                    // Project-specific acronyms
                    'PPTX', 'XLSX', 'DOCX', 'JS', 'BSA', 'MCP',
                ],
                ignoreRegex: [
                    'http://localhost:\\d+',
                    '\\.obsidian-agent/',
                    '[a-z]+\\.openai\\.com',
                    'openrouter\\.ai',
                    '/openai\\b',
                    'use_mcp_tool',
                    'the rest of',
                    'gpt-4o',
                ],
                ignoreWords: [
                    'roleDefinition', 'kB', 'PDFs', 'URLs', 'APIs', 'German',
                ],
            }],
        },
    },
    {
        ignores: ['node_modules/', 'main.js', 'forked-kilocode/', '_devprocess/', 'docs/'],
    }
);
