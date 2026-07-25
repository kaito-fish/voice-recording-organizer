const { parseDateFromFilename, getNextFileNumber } = require('../src/main.js');

describe('parseDateFromFilename', () => {
    test('parses "YYYY-MM-DD_HH-mm-ss" format', () => {
        const date = parseDateFromFilename('2024-05-20_09-30-00.m4a');
        expect(date).toEqual(new Date(2024, 4, 20, 9, 30, 0));
    });

    test('parses "YYYYMMDD_HHMMSS" format', () => {
        const date = parseDateFromFilename('20240520_093000.m4a');
        expect(date).toEqual(new Date(2024, 4, 20, 9, 30, 0));
    });

    test('parses "YYYYMMDDHHMMSS" format', () => {
        const date = parseDateFromFilename('20240520093000.m4a');
        expect(date).toEqual(new Date(2024, 4, 20, 9, 30, 0));
    });

    test('returns null when the filename matches no known pattern', () => {
        expect(parseDateFromFilename('recording.m4a')).toBeNull();
    });

    test('only matches at the start of the filename', () => {
        expect(parseDateFromFilename('prefix_20240520093000.m4a')).toBeNull();
    });
});

describe('getNextFileNumber', () => {
    function mockFolder(fileNames) {
        return {
            getFiles() {
                const names = [...fileNames];
                return {
                    hasNext() {
                        return names.length > 0;
                    },
                    next() {
                        const name = names.shift();
                        return { getName: () => name };
                    }
                };
            }
        };
    }

    test('returns 1 when the folder has no matching files', () => {
        const folder = mockFolder(['2024-05-20_定例会議_01.m4a']);
        expect(getNextFileNumber(folder, '2024-05-21_定例会議', '.m4a')).toBe(1);
    });

    test('returns the max existing number + 1', () => {
        const folder = mockFolder([
            '2024-05-20_定例会議_01.m4a',
            '2024-05-20_定例会議_02.m4a',
            'unrelated.m4a'
        ]);
        expect(getNextFileNumber(folder, '2024-05-20_定例会議', '.m4a')).toBe(3);
    });

    test('ignores gaps and only considers the max number', () => {
        const folder = mockFolder([
            '2024-05-20_定例会議_01.m4a',
            '2024-05-20_定例会議_05.m4a'
        ]);
        expect(getNextFileNumber(folder, '2024-05-20_定例会議', '.m4a')).toBe(6);
    });

    test('does not match a different base name or extension', () => {
        const folder = mockFolder([
            '2024-05-20_他の会議_01.m4a',
            '2024-05-20_定例会議_01.wav'
        ]);
        expect(getNextFileNumber(folder, '2024-05-20_定例会議', '.m4a')).toBe(1);
    });

    test('escapes regex-special characters in base name and extension', () => {
        const folder = mockFolder(['2024-05-20_Q&A(1)_01.m4a']);
        expect(getNextFileNumber(folder, '2024-05-20_Q&A(1)', '.m4a')).toBe(2);
    });
});
