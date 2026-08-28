from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one guarded anchor, found {count}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


logic = "apps/web/src/components/Sidebar.logic.ts"
helper = '''export function nextCollapsedProjectSectionKeys(input: {
  projectKeys: readonly string[];
  collapsedProjectKeys: readonly string[];
}): string[] {
  const projectKeys = [...new Set(input.projectKeys)];
  if (projectKeys.length === 0) return [...input.collapsedProjectKeys];

  const projectKeySet = new Set(projectKeys);
  const collapsedProjectKeySet = new Set(input.collapsedProjectKeys);
  const allCollapsed = projectKeys.every((projectKey) => collapsedProjectKeySet.has(projectKey));

  if (allCollapsed) {
    return input.collapsedProjectKeys.filter((projectKey) => !projectKeySet.has(projectKey));
  }

  return [...new Set([...input.collapsedProjectKeys, ...projectKeys])];
}

'''
replace_once(
    logic,
    'export interface SidebarProjectThreadSection<TProject, TThread> {\n',
    helper + 'export interface SidebarProjectThreadSection<TProject, TThread> {\n',
)


test = "apps/web/src/components/Sidebar.logic.test.ts"
replace_once(
    test,
    '  isTrailingDoubleClick,\n  orderItemsByPreferredIds,\n',
    '  isTrailingDoubleClick,\n  nextCollapsedProjectSectionKeys,\n  orderItemsByPreferredIds,\n',
)
test_path = Path(test)
test_text = test_path.read_text(encoding="utf-8")
if 'describe("nextCollapsedProjectSectionKeys"' in test_text:
    raise SystemExit("Sidebar.logic.test.ts: bulk collapse regression block already exists")
test_text += '''\n\ndescribe("nextCollapsedProjectSectionKeys", () => {
  it("collapses every visible project when any visible project is expanded", () => {
    expect(
      nextCollapsedProjectSectionKeys({
        projectKeys: ["a", "b", "c"],
        collapsedProjectKeys: ["b", "stale"],
      }),
    ).toEqual(["b", "stale", "a", "c"]);
  });

  it("expands every visible project when all visible projects are collapsed", () => {
    expect(
      nextCollapsedProjectSectionKeys({
        projectKeys: ["a", "b"],
        collapsedProjectKeys: ["stale", "a", "b"],
      }),
    ).toEqual(["stale"]);
  });

  it("does nothing when there are no visible projects", () => {
    expect(
      nextCollapsedProjectSectionKeys({
        projectKeys: [],
        collapsedProjectKeys: ["existing"],
      }),
    ).toEqual(["existing"]);
  });
});
'''
test_path.write_text(test_text, encoding="utf-8")
