from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one guarded anchor, found {count}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


logic = "apps/web/src/components/Sidebar.logic.ts"
helper = '''export interface SidebarProjectThreadSection<TProject, TThread> {
  project: TProject;
  pinnedThreads: TThread[];
  activeThreads: TThread[];
  snoozedThreads: TThread[];
  settledThreads: TThread[];
}

export interface SidebarUngroupedThreadBuckets<TThread> {
  pinnedThreads: TThread[];
  activeThreads: TThread[];
  snoozedThreads: TThread[];
  settledThreads: TThread[];
}

export function buildSidebarProjectThreadSections<
  TProject extends LogicalSidebarProject,
  TThread extends Pick<ScopedSidebarThread, "environmentId" | "projectId">,
>(input: {
  projects: readonly TProject[];
  pinnedThreads: readonly TThread[];
  activeThreads: readonly TThread[];
  snoozedThreads: readonly TThread[];
  settledThreads: readonly TThread[];
}): {
  sections: SidebarProjectThreadSection<TProject, TThread>[];
  ungroupedThreads: SidebarUngroupedThreadBuckets<TThread>;
} {
  const sections = input.projects.map(
    (project): SidebarProjectThreadSection<TProject, TThread> => ({
      project,
      pinnedThreads: [],
      activeThreads: [],
      snoozedThreads: [],
      settledThreads: [],
    }),
  );
  const sectionByProjectKey = new Map(
    sections.map((section) => [section.project.projectKey, section] as const),
  );
  const projectKeyByPhysicalRef = new Map(
    input.projects.flatMap((project) =>
      project.memberProjectRefs.map(
        (projectRef) =>
          [`${projectRef.environmentId}\\0${projectRef.projectId}`, project.projectKey] as const,
      ),
    ),
  );
  const ungroupedThreads: SidebarUngroupedThreadBuckets<TThread> = {
    pinnedThreads: [],
    activeThreads: [],
    snoozedThreads: [],
    settledThreads: [],
  };
  const assignThreads = (
    threads: readonly TThread[],
    selectTarget: (section: SidebarProjectThreadSection<TProject, TThread>) => TThread[],
    fallback: TThread[],
  ) => {
    for (const thread of threads) {
      const projectKey = projectKeyByPhysicalRef.get(
        `${thread.environmentId}\\0${thread.projectId}`,
      );
      const section = projectKey ? sectionByProjectKey.get(projectKey) : undefined;
      (section ? selectTarget(section) : fallback).push(thread);
    }
  };

  assignThreads(input.pinnedThreads, (section) => section.pinnedThreads, ungroupedThreads.pinnedThreads);
  assignThreads(input.activeThreads, (section) => section.activeThreads, ungroupedThreads.activeThreads);
  assignThreads(input.snoozedThreads, (section) => section.snoozedThreads, ungroupedThreads.snoozedThreads);
  assignThreads(input.settledThreads, (section) => section.settledThreads, ungroupedThreads.settledThreads);

  return { sections, ungroupedThreads };
}

'''
replace_once(
    logic,
    'export type ThreadTraversalDirection = "previous" | "next";\n',
    helper + 'export type ThreadTraversalDirection = "previous" | "next";\n',
)


test = "apps/web/src/components/Sidebar.logic.test.ts"
replace_once(
    test,
    '  buildMultiSelectThreadContextMenuItems,\n  createThreadJumpHintVisibilityController,\n',
    '  buildMultiSelectThreadContextMenuItems,\n  buildSidebarProjectThreadSections,\n  createThreadJumpHintVisibilityController,\n',
)
test_path = Path(test)
test_text = test_path.read_text(encoding="utf-8")
if 'describe("buildSidebarProjectThreadSections"' in test_text:
    raise SystemExit("Sidebar.logic.test.ts: grouping regression block already exists")
test_text += '''\n\ndescribe("buildSidebarProjectThreadSections", () => {
  it("preserves logical project order, groups physical members, and never drops orphan threads", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const projectALocal = ProjectId.make("project-a-local");
    const projectARemote = ProjectId.make("project-a-remote");
    const projectB = ProjectId.make("project-b");
    const orphanProject = ProjectId.make("project-orphan");
    const projects = [
      {
        id: "representative-a",
        title: "Project A",
        projectKey: "logical-a",
        memberProjectRefs: [
          { environmentId: localEnvironmentId, projectId: projectALocal },
          { environmentId: remoteEnvironmentId, projectId: projectARemote },
        ],
      },
      {
        id: "representative-b",
        title: "Project B",
        projectKey: "logical-b",
        memberProjectRefs: [{ environmentId: localEnvironmentId, projectId: projectB }],
      },
    ];
    const makeSectionThread = (
      id: string,
      environmentId: EnvironmentId,
      projectId: ProjectId,
    ) => ({ id, environmentId, projectId });

    const result = buildSidebarProjectThreadSections({
      projects,
      pinnedThreads: [makeSectionThread("pinned-a", remoteEnvironmentId, projectARemote)],
      activeThreads: [
        makeSectionThread("active-a", localEnvironmentId, projectALocal),
        makeSectionThread("active-b", localEnvironmentId, projectB),
        makeSectionThread("active-orphan", localEnvironmentId, orphanProject),
      ],
      snoozedThreads: [makeSectionThread("snoozed-b", localEnvironmentId, projectB)],
      settledThreads: [makeSectionThread("settled-a", localEnvironmentId, projectALocal)],
    });

    expect(
      result.sections.map((section) => ({
        projectKey: section.project.projectKey,
        pinned: section.pinnedThreads.map((thread) => thread.id),
        active: section.activeThreads.map((thread) => thread.id),
        snoozed: section.snoozedThreads.map((thread) => thread.id),
        settled: section.settledThreads.map((thread) => thread.id),
      })),
    ).toEqual([
      {
        projectKey: "logical-a",
        pinned: ["pinned-a"],
        active: ["active-a"],
        snoozed: [],
        settled: ["settled-a"],
      },
      {
        projectKey: "logical-b",
        pinned: [],
        active: ["active-b"],
        snoozed: ["snoozed-b"],
        settled: [],
      },
    ]);
    expect(result.ungroupedThreads.activeThreads.map((thread) => thread.id)).toEqual([
      "active-orphan",
    ]);
  });
});
'''
test_path.write_text(test_text, encoding="utf-8")
