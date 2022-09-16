import {BoundType} from '../core/bound-type';
import {NumberRange} from './number-range';

describe('Range', () => {
  describe('toString', () => {
    it('should print open ranges', () => {
      expect(NumberRange.open(4, 9).toString()).toBe('(4..9)');
    });

    it('should print closed ranges', () => {
      expect(NumberRange.closed(4, 9).toString()).toBe('[4..9]');
    });

    it('should print closed open ranges', () => {
      expect(NumberRange.closedOpen(4, 9).toString()).toBe('[4..9)');
    });

    it('should print all', () => {
      expect(NumberRange.all().toString()).toBe('(-∞..+∞)');
    });

    it('should print Dates using toISOString()', () => {
      expect(NumberRange.open(new Date(4), new Date(9)).toString()).toBe('(1970-01-01T00:00:00.004Z..1970-01-01T00:00:00.009Z)');
    })
  });

  describe('contains', () => {
    describe('closed open', () => {
      it('should match on a closed endpoint', () => {
        expect(NumberRange.closedOpen(2, 4).contains(2)).toBeTrue();
        expect(NumberRange.closedOpen(new Date(2), new Date(4)).contains(2)).toBeTrue();
        expect(NumberRange.closedOpen(new Date(2), new Date(4)).contains(new Date(2))).toBeTrue();
      });

      it('should not match on an open endpoint', () => {
        expect(NumberRange.closedOpen(2, 4).contains(4)).toBeFalse();
        expect(NumberRange.closedOpen(new Date(2), new Date(4)).contains(new Date(4))).toBeFalse();
      });

      it('should match on a number inside', () => {
        expect(NumberRange.closedOpen(2, 4).contains(3)).toBeTrue();
        expect(NumberRange.closedOpen(new Date(2), new Date(4)).contains(new Date(3))).toBeTrue();
      });

      it('should not match on a number before', () => {
        expect(NumberRange.closedOpen(2, 4).contains(1)).toBeFalse();
      });

      it('should not match on a number after', () => {
        expect(NumberRange.closedOpen(2, 4).contains(5)).toBeFalse();
      });
    });

    describe('closed', () => {
      it('should match on a closed lower endpoint', () => {
        expect(NumberRange.closed(2, 4).contains(2)).toBeTrue();
      });

      it('should match on a closed upper endpoint', () => {
        expect(NumberRange.closed(2, 4).contains(4)).toBeTrue();
      });

      it('should match on a number inside', () => {
        expect(NumberRange.closed(2, 4).contains(3)).toBeTrue();
      });

      it('should not match on a number before', () => {
        expect(NumberRange.closed(2, 4).contains(1)).toBeFalse();
      });

      it('should not match on a number after', () => {
        expect(NumberRange.closed(2, 4).contains(5)).toBeFalse();
      });
    });

    describe('atMost', () => {
      it('should match equal to the bound', () => {
        expect(NumberRange.atMost(5).contains(5)).toBeTrue();
      });

      it('should match below', () => {
        expect(NumberRange.atMost(5).contains(4)).toBeTrue();
      });

      it('should not match above', () => {
        expect(NumberRange.atMost(5).contains(6)).toBeFalse();
      });
    });

    describe('atLeast', () => {
      it('should match equal to the bound', () => {
        expect(NumberRange.atLeast(5).contains(5)).toBeTrue();
      });

      it('should not match below', () => {
        expect(NumberRange.atLeast(5).contains(4)).toBeFalse();
      });

      it('should match above', () => {
        expect(NumberRange.atLeast(5).contains(6)).toBeTrue();
      });
    });
  });

  describe('isConnected', () => {
    it('should be false when there is a gap between two closed open ranges', () => {
      expect(
        NumberRange.closedOpen(2, 4).isConnected(NumberRange.closedOpen(5, 7))
      ).toBeFalse();
      expect(
        NumberRange.closedOpen(5, 7).isConnected(NumberRange.closedOpen(2, 4))
      ).toBeFalse();
    });

    it('should be true when two closed open ranges overlap', () => {
      expect(
        NumberRange.closedOpen(2, 4).isConnected(NumberRange.closedOpen(3, 4))
      ).toBeTrue();
      expect(
        NumberRange.closedOpen(3, 4).isConnected(NumberRange.closedOpen(2, 4))
      ).toBeTrue();
    });

    it('should be true when a closed and open range touch on the same value', () => {
      expect(
        NumberRange.closedOpen(2, 4).isConnected(NumberRange.closedOpen(4, 6))
      ).toBeTrue();
      expect(
        NumberRange.closedOpen(4, 6).isConnected(NumberRange.closedOpen(2, 4))
      ).toBeTrue();
    });

    it('should be false when two open ranges do not touch', () => {
      expect(
        NumberRange.upTo(4, BoundType.OPEN).isConnected(NumberRange.atLeast(6))
      ).toBeFalse();
      expect(
        NumberRange.atLeast(6).isConnected(NumberRange.upTo(4, BoundType.OPEN))
      ).toBeFalse();
    });

    it('should be true when one closedOpen range encloses the other', () => {
      expect(
        NumberRange.closedOpen(2, 10).isConnected(NumberRange.closedOpen(4, 6))
      ).toBeTrue();
      expect(
        NumberRange.closedOpen(4, 6).isConnected(NumberRange.closedOpen(2, 10))
      ).toBeTrue();
    });
  });

  describe('intersecting', () => {
    it('should intersect with closedOpen and atLeast', () => {
      const result = NumberRange.closedOpen(2, 4).intersection(
        NumberRange.atLeast(3)
      );
      expect(result?.toString()).toBe('[3..4)');
    });

    it('should intersect with Date closedOpen and Date atLeast', () => {
      const result = NumberRange.closedOpen(new Date(2), new Date(4)).intersection(
        NumberRange.atLeast(new Date(3))
      );
      expect(result?.toString()).toBe('[1970-01-01T00:00:00.003Z..1970-01-01T00:00:00.004Z)');
    });

    it('should intersect with Date closedOpen and number atLeast', () => {
      const result = NumberRange.closedOpen(new Date(2), new Date(4)).intersection(
        NumberRange.atLeast(3)
      );
      // Note that the resulting Range is mixed, no conversions are performed.
      expect(result?.toString()).toBe('[3..1970-01-01T00:00:00.004Z)');
    });

    it('should intersect with closedOpen and atMost', () => {
      const result = NumberRange.closedOpen(2, 4).intersection(
        NumberRange.atMost(3)
      );
      expect(result?.toString()).toBe('[2..3]');
    });

    it('should be able to handle an empty range', () => {
      const result = NumberRange.closedOpen(2, 4).intersection(
        NumberRange.closedOpen(4, 6)
      );
      expect(result?.toString()).toBe('[4..4)');
    });

    it('should be able to handle a range containing one value', () => {
      const result = NumberRange.closed(2, 4).intersection(
        NumberRange.closedOpen(4, 6)
      );
      expect(result?.toString()).toBe('[4..4]');
    });
  });

  describe('span', () => {
    it('should work for two non connecting closedOpen ranges', () => {
      const range1 = NumberRange.closedOpen(1, 5);
      const range2 = NumberRange.closedOpen(8, 12);

      const result = range1.span(range2);

      expect(result.toString()).toBe('[1..12)');
    });

    it('should work for two overlapping closedOpen ranges', () => {
      const range1 = NumberRange.closedOpen(1, 10);
      const range2 = NumberRange.closedOpen(7, 12);

      const result = range1.span(range2);

      expect(result.toString()).toBe('[1..12)');
    });

    it('should work for a closedOpen and open range', () => {
      const range1 = NumberRange.closedOpen(1, 5);
      const range2 = NumberRange.atLeast(7);

      const result = range1.span(range2);

      expect(result.toString()).toBe('[1..+∞)');
    });

    it('should work for with two non connecting open ranges', () => {
      const range1 = NumberRange.atMost(4);
      const range2 = NumberRange.atLeast(7);

      const result = range1.span(range2);

      expect(result.toString()).toBe('(-∞..+∞)');
      expect(result.lowerBoundType).toBe(BoundType.OPEN);
      expect(result.lowerEndpoint).toBe(Number.NEGATIVE_INFINITY);
      expect(result.upperBoundType).toBe(BoundType.OPEN);
      expect(result.upperEndpoint).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe('overlaps', () => {
    it('should be false when there is no overlap', () => {
      // first before second
      expect(
        NumberRange.closedOpen(2, 4).overlaps(NumberRange.closedOpen(6, 8))
      ).toBeFalse();
      expect(
        NumberRange.closedOpen(2, 4).overlaps(NumberRange.closedOpen(4, 8))
      ).toBeFalse();
      expect(
        NumberRange.closed(2, 4).overlaps(NumberRange.closedOpen(5, 8))
      ).toBeFalse();

      // first after second
      expect(
        NumberRange.closedOpen(10, 20).overlaps(
          NumberRange.closedOpen(21, 30)
        )
      ).toBeFalse();
      expect(
        NumberRange.closedOpen(10, 20).overlaps(
          NumberRange.closedOpen(25, 30)
        )
      ).toBeFalse();
      expect(
        NumberRange.closedOpen(10, 20).overlaps(NumberRange.closed(20, 30))
      ).toBeFalse();
    });

    it('should be true when the ranges overlap in any way', () => {
      // first overlaps start of second
      expect(
        NumberRange.closedOpen(10, 20).overlaps(
          NumberRange.closedOpen(19, 30)
        )
      ).toBeTrue();
      expect(
        NumberRange.closedOpen(10, 20).overlaps(
          NumberRange.closedOpen(18, 30)
        )
      ).toBeTrue();
      expect(
        NumberRange.closed(10, 20).overlaps(NumberRange.closedOpen(20, 30))
      ).toBeTrue();
      expect(
        NumberRange.closed(10, 20).overlaps(NumberRange.closedOpen(19, 30))
      ).toBeTrue();

      // first totally overlaps second
      expect(
        NumberRange.closedOpen(10, 20).overlaps(
          NumberRange.closedOpen(10, 20)
        )
      ).toBeTrue();
      expect(
        NumberRange.closedOpen(10, 20).overlaps(
          NumberRange.closedOpen(11, 19)
        )
      ).toBeTrue();
      expect(
        NumberRange.closed(10, 20).overlaps(NumberRange.closedOpen(10, 20))
      ).toBeTrue();
      expect(
        NumberRange.closed(10, 20).overlaps(NumberRange.closedOpen(11, 20))
      ).toBeTrue();
      expect(
        NumberRange.closed(10, 20).overlaps(NumberRange.closedOpen(10, 19))
      ).toBeTrue();

      // first overlaps end of second
      expect(
        NumberRange.closedOpen(20, 30).overlaps(
          NumberRange.closedOpen(10, 21)
        )
      ).toBeTrue();
      expect(
        NumberRange.closedOpen(20, 30).overlaps(
          NumberRange.closedOpen(11, 22)
        )
      ).toBeTrue();
      expect(
        NumberRange.closed(20, 30).overlaps(NumberRange.closedOpen(10, 21))
      ).toBeTrue();
      expect(
        NumberRange.closed(20, 30).overlaps(NumberRange.closedOpen(11, 22))
      ).toBeTrue();
      expect(
        NumberRange.closedOpen(20, 30).overlaps(NumberRange.closed(10, 20))
      ).toBeTrue();
      expect(
        NumberRange.closedOpen(20, 30).overlaps(NumberRange.closed(11, 21))
      ).toBeTrue();
      expect(
        NumberRange.closed(20, 30).overlaps(NumberRange.closed(10, 20))
      ).toBeTrue();
      expect(
        NumberRange.closed(20, 30).overlaps(NumberRange.closed(11, 21))
      ).toBeTrue();

      // first inside of second
      expect(
        NumberRange.closedOpen(20, 30).overlaps(
          NumberRange.closedOpen(20, 29)
        )
      ).toBeTrue();
      expect(
        NumberRange.closedOpen(20, 30).overlaps(
          NumberRange.closedOpen(20, 30)
        )
      ).toBeTrue();
      expect(
        NumberRange.closedOpen(20, 30).overlaps(
          NumberRange.closedOpen(20, 31)
        )
      ).toBeTrue();
      expect(
        NumberRange.closedOpen(20, 30).overlaps(
          NumberRange.closedOpen(19, 31)
        )
      ).toBeTrue();

      expect(
        NumberRange.closed(20, 30).overlaps(NumberRange.closedOpen(20, 30))
      ).toBeTrue();
      expect(
        NumberRange.closed(20, 30).overlaps(NumberRange.closedOpen(19, 30))
      ).toBeTrue();
      expect(
        NumberRange.closed(20, 30).overlaps(NumberRange.closedOpen(20, 31))
      ).toBeTrue();

      expect(
        NumberRange.closed(20, 30).overlaps(NumberRange.closed(20, 30))
      ).toBeTrue();
      expect(
        NumberRange.closed(20, 30).overlaps(NumberRange.closed(19, 31))
      ).toBeTrue();
      expect(
        NumberRange.closed(20, 30).overlaps(NumberRange.closed(19, 30))
      ).toBeTrue();
      expect(
        NumberRange.closed(20, 30).overlaps(NumberRange.closed(20, 31))
      ).toBeTrue();
    });
  });

  describe('encloses', () => {
    it('a closedOpen should enclose itself', () => {
      const range = NumberRange.closedOpen(1, 20);
      expect(range.encloses(range)).toBeTrue();
    });

    it('should work on two closedOpen ranges', () => {
      const largeRange = NumberRange.closedOpen(3, 10);
      const smallRange = NumberRange.closedOpen(4, 6);

      expect(largeRange.encloses(smallRange)).toBeTrue();
      expect(smallRange.encloses(largeRange)).toBeFalse();
    });

    describe('docs specifications', () => {
      // See  https://guava.dev/releases/19.0/api/docs/com/google/common/collect/Range.html#encloses(com.google.common.collect.Range)

      it('[3...6] encloses [4..5]', () => {
        const r1 = NumberRange.closed(3, 6)
        const r2 = NumberRange.closed(4, 5);

        expect(r1.encloses(r2)).toBeTrue()
      })

      it('(3..6) encloses (3..6)', () => {
        const r1 = NumberRange.open(3, 6)
        const r2 = NumberRange.open(3, 6);

        expect(r1.encloses(r2)).toBeTrue()
      })

      it('[3..6] encloses [4..4)', () => {
        const r1 = NumberRange.closed(3, 6)
        const r2 = NumberRange.closedOpen(4, 4);

        expect(r1.encloses(r2)).toBeTrue()
      })

      it('(3..6] does not enclose [3..6] ', () => {
        const r1 = NumberRange.openClosed(3, 6);
        const r2 = NumberRange.closed(3, 6);

        expect(r1.encloses(r2)).toBeFalse()
      })

      it('[4..5] does not enclose (3..6)', () => {
        const r1 = NumberRange.closed(4, 5)
        const r2 = NumberRange.open(3, 6);

        expect(r1.encloses(r2)).toBeFalse()
      })

      it('[3..6] does not enclose (1..1]', () => {
        const r1 = NumberRange.closed(3, 6)
        const r2 = NumberRange.openClosed(1, 1);

        expect(r1.encloses(r2)).toBeFalse()
      })
    })
  });

  describe('isEmpty', () => {
    it('should support Dates', () => {
      expect(NumberRange.closedOpen(new Date(0), new Date(0)).isEmpty()).toBeTrue();
    })
  })
});


