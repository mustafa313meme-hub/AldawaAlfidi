import { depthOf, wouldCreateCycle } from './category-tree';

const tree = new Map<string, string | null>([['a', null], ['b', 'a'], ['c', 'b'], ['x', null]]);

describe('category tree', () => {
  it('detects moving a node under its own descendant', () => {
    expect(wouldCreateCycle(tree, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(tree, 'a', 'a')).toBe(true);
  });
  it('allows valid moves', () => {
    expect(wouldCreateCycle(tree, 'c', 'x')).toBe(false);
    expect(wouldCreateCycle(tree, 'b', null)).toBe(false);
  });
  it('computes depth', () => {
    expect(depthOf(tree, null)).toBe(0);
    expect(depthOf(tree, 'a')).toBe(1);
    expect(depthOf(tree, 'c')).toBe(3);
  });
});
