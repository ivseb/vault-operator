import { describe, it, expect } from 'vitest';
import { parseCsv } from '../parsers/CsvParser';

function toArrayBuffer(text: string): ArrayBuffer {
    return new TextEncoder().encode(text).buffer;
}

describe('parseCsv', () => {
    it('should parse simple comma-delimited CSV', () => {
        const result = parseCsv(toArrayBuffer('Name,Age\nAlice,30\nBob,25'));
        expect(result.text).toContain('| Name | Age |');
        expect(result.text).toContain('| Alice | 30 |');
        expect(result.text).toContain('| Bob | 25 |');
        expect(result.text).toContain('2 rows');
    });

    it('should detect semicolon delimiter', () => {
        const result = parseCsv(toArrayBuffer('Name;City\nAlice;Berlin\nBob;Munich'));
        expect(result.text).toContain('| Name | City |');
        expect(result.text).toContain('| Alice | Berlin |');
    });

    it('should detect tab delimiter', () => {
        const result = parseCsv(toArrayBuffer('Name\tCity\nAlice\tBerlin'));
        expect(result.text).toContain('| Name | City |');
    });

    it('should handle quoted fields with commas', () => {
        const result = parseCsv(toArrayBuffer('Name,Address\n"Smith, John","123 Main St"'));
        expect(result.text).toContain('Smith, John');
        expect(result.text).toContain('123 Main St');
    });

    it('should handle escaped quotes in quoted fields', () => {
        const result = parseCsv(toArrayBuffer('Quote\n"He said ""hello"""'));
        expect(result.text).toContain('He said "hello"');
    });

    it('should handle empty CSV', () => {
        const result = parseCsv(toArrayBuffer(''));
        expect(result.text).toContain('empty CSV');
    });

    it('should handle whitespace-only CSV', () => {
        const result = parseCsv(toArrayBuffer('   \n  '));
        expect(result.text).toContain('empty CSV');
    });

    it('should handle Windows-style line endings (\\r\\n)', () => {
        const result = parseCsv(toArrayBuffer('A,B\r\n1,2\r\n3,4'));
        expect(result.text).toContain('| A | B |');
        expect(result.text).toContain('| 1 | 2 |');
        expect(result.text).toContain('| 3 | 4 |');
    });

    it('should escape pipe characters in cells', () => {
        const result = parseCsv(toArrayBuffer('Data\n"value|with|pipes"'));
        expect(result.text).toContain('\\|');
    });

    it('should pad short rows to header length', () => {
        const result = parseCsv(toArrayBuffer('A,B,C\n1'));
        // Row with only 1 value should be padded to 3 columns
        expect(result.text).toContain('| 1 |');
    });

    it('should return correct metadata', () => {
        const result = parseCsv(toArrayBuffer('H\n1'));
        expect(result.metadata.format).toBe('csv');
        expect(result.images).toEqual([]);
    });
});
