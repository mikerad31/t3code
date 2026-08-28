from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one guarded anchor, found {count}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


sidebar = "apps/web/src/components/Sidebar.tsx"
replace_once(
    sidebar,
    '  buildBulkTitleRegenerationContextMenuItem,\n  formatWorkingDurationLabel,\n',
    '  buildBulkTitleRegenerationContextMenuItem,\n  buildSidebarProjectThreadSections,\n  formatWorkingDurationLabel,\n',
)
replace_once(
    sidebar,
    'const SNOOZED_SHELF_EXPANDED_KEY = "t3code:sidebar-v2:snoozed-expanded";\n',
    'const SNOOZED_SHELF_EXPANDED_KEY = "t3code:sidebar-v2:snoozed-expanded";\nconst COLLAPSED_PROJECT_SECTIONS_KEY = "t3code:sidebar-v2:collapsed-project-sections";\nconst COLLAPSED_PROJECT_SECTIONS_SCHEMA = Schema.Array(Schema.String);\n',
)

project_header = '''function SidebarProjectSectionHeader(props: {
  project: SidebarProjectSnapshot;
  expanded: boolean;
  threadCount: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-thread-selection-safe
      aria-expanded={props.expanded}
      aria-label={`${props.expanded ? "Collapse" : "Expand"} ${props.project.displayName}`}
      onClick={props.onToggle}
      className="group/project-section flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "size-3.5 shrink-0 text-sidebar-muted-foreground/70 transition-transform",
          !props.expanded && "-rotate-90",
        )}
      />
      <ProjectFavicon
        environmentId={props.project.environmentId}
        cwd={props.project.workspaceRoot}
        faviconPath={props.project.faviconPath}
        className="size-4 shrink-0"
      />
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-sidebar-muted-foreground group-hover/project-section:text-sidebar-foreground">
        {props.project.displayName}
      </span>
      {props.project.groupedProjectCount > 1 ? (
        <span className="shrink-0 text-[10px] text-sidebar-muted-foreground/45">
          {props.project.groupedProjectCount} roots
        </span>
      ) : null}
      <span className="min-w-4 shrink-0 text-right text-[10px] tabular-nums text-sidebar-muted-foreground/45">
        {props.threadCount}
      </span>
    </button>
  );
}

'''
replace_once(sidebar, 'export default function Sidebar() {\n', project_header + 'export default function Sidebar() {\n')

scope_effect = '''  useEffect(() => {
    if (projectScopeKey !== null && scopedProjectGroup === null) {
      setProjectScopeKey(null);
    }
  }, [projectScopeKey, scopedProjectGroup]);
'''
collapse_state = scope_effect + '''  const [collapsedProjectSectionKeys, setCollapsedProjectSectionKeys] = useLocalStorage(
    COLLAPSED_PROJECT_SECTIONS_KEY,
    [],
    COLLAPSED_PROJECT_SECTIONS_SCHEMA,
  );
  const collapsedProjectSectionKeySet = useMemo(
    () => new Set(collapsedProjectSectionKeys),
    [collapsedProjectSectionKeys],
  );
  useEffect(() => {
    const validProjectKeys = new Set(projectGroups.map((project) => project.projectKey));
    setCollapsedProjectSectionKeys((current) => {
      const next = current.filter((projectKey) => validProjectKeys.has(projectKey));
      return next.length === current.length ? current : next;
    });
  }, [projectGroups, setCollapsedProjectSectionKeys]);
  const toggleProjectSection = useCallback(
    (projectKey: string) => {
      setCollapsedProjectSectionKeys((current) =>
        current.includes(projectKey)
          ? current.filter((candidate) => candidate !== projectKey)
          : [...current, projectKey],
      );
    },
    [setCollapsedProjectSectionKeys],
  );
'''
replace_once(sidebar, scope_effect, collapse_state)

ordered_old = '''  const orderedThreads = useMemo(
    () => [...pinnedThreads, ...activeThreads, ...visibleSnoozedThreads, ...renderedSettledThreads],
    [pinnedThreads, activeThreads, visibleSnoozedThreads, renderedSettledThreads],
  );
'''
ordered_new = '''  const { sections: projectThreadSections, ungroupedThreads } = useMemo(
    () =>
      buildSidebarProjectThreadSections({
        projects: projectGroups,
        pinnedThreads,
        activeThreads,
        snoozedThreads,
        settledThreads,
      }),
    [activeThreads, pinnedThreads, projectGroups, settledThreads, snoozedThreads],
  );
  const visibleSnoozedThreadKeySet = useMemo(
    () =>
      new Set(
        visibleSnoozedThreads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      ),
    [visibleSnoozedThreads],
  );
  const renderedSettledThreadKeySet = useMemo(
    () =>
      new Set(
        renderedSettledThreads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      ),
    [renderedSettledThreads],
  );
  const groupedVisibleThreads = useMemo(() => {
    const visibleThreads: EnvironmentThreadShell[] = [];
    for (const section of projectThreadSections) {
      const visibleSnoozed = section.snoozedThreads.filter((thread) =>
        visibleSnoozedThreadKeySet.has(
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      );
      const visibleSettled = section.settledThreads.filter((thread) =>
        renderedSettledThreadKeySet.has(
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      );
      const sectionThreads = [
        ...section.pinnedThreads,
        ...section.activeThreads,
        ...visibleSnoozed,
        ...visibleSettled,
      ];
      const routeKeepsSectionExpanded =
        routeThreadKey !== null &&
        sectionThreads.some(
          (thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === routeThreadKey,
        );
      if (
        !collapsedProjectSectionKeySet.has(section.project.projectKey) ||
        routeKeepsSectionExpanded
      ) {
        visibleThreads.push(...sectionThreads);
      }
    }
    visibleThreads.push(
      ...ungroupedThreads.pinnedThreads,
      ...ungroupedThreads.activeThreads,
      ...ungroupedThreads.snoozedThreads.filter((thread) =>
        visibleSnoozedThreadKeySet.has(
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      ),
      ...ungroupedThreads.settledThreads.filter((thread) =>
        renderedSettledThreadKeySet.has(
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      ),
    );
    return visibleThreads;
  }, [
    collapsedProjectSectionKeySet,
    projectThreadSections,
    renderedSettledThreadKeySet,
    routeThreadKey,
    ungroupedThreads,
    visibleSnoozedThreadKeySet,
  ]);
  const orderedThreads = useMemo(
    () =>
      scopedProjectGroup === null
        ? groupedVisibleThreads
        : [
            ...pinnedThreads,
            ...activeThreads,
            ...visibleSnoozedThreads,
            ...renderedSettledThreads,
          ],
    [
      activeThreads,
      groupedVisibleThreads,
      pinnedThreads,
      renderedSettledThreads,
      scopedProjectGroup,
      visibleSnoozedThreads,
    ],
  );
'''
replace_once(sidebar, ordered_old, ordered_new)

anchor = '''                  ];
                  if (pinnedThreads.length > 0) {
'''
render_grouped = '''                  ];
                  if (scopedProjectGroup === null) {
                    for (const section of projectThreadSections) {
                      const visibleSnoozed = section.snoozedThreads.filter((thread) =>
                        visibleSnoozedThreadKeySet.has(
                          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                        ),
                      );
                      const visibleSettled = section.settledThreads.filter((thread) =>
                        renderedSettledThreadKeySet.has(
                          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                        ),
                      );
                      const threadCount =
                        section.pinnedThreads.length +
                        section.activeThreads.length +
                        section.snoozedThreads.length +
                        section.settledThreads.length;
                      const routeKeepsSectionExpanded =
                        routeThreadKey !== null &&
                        [
                          ...section.pinnedThreads,
                          ...section.activeThreads,
                          ...visibleSnoozed,
                          ...visibleSettled,
                        ].some(
                          (thread) =>
                            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) ===
                            routeThreadKey,
                        );
                      const sectionExpanded =
                        routeKeepsSectionExpanded ||
                        !collapsedProjectSectionKeySet.has(section.project.projectKey);
                      items.push(
                        <li
                          key={`project-section:${section.project.projectKey}`}
                          data-thread-selection-safe
                          className="mt-2 list-none first:mt-0"
                        >
                          <SidebarProjectSectionHeader
                            project={section.project}
                            expanded={sectionExpanded}
                            threadCount={threadCount}
                            onToggle={() => toggleProjectSection(section.project.projectKey)}
                          />
                          {sectionExpanded ? (
                            <ul
                              role="list"
                              aria-label={`${section.project.displayName} threads`}
                              className="ml-2.5 flex flex-col gap-px border-l border-sidebar-border/50 pl-1.5"
                            >
                              {section.pinnedThreads.map((thread) =>
                                renderThreadRow(thread, "pinned"),
                              )}
                              {section.pinnedThreads.length > 0 && section.activeThreads.length > 0 ? (
                                <li aria-hidden className="mx-2 my-1 h-px list-none bg-sidebar-border/45" />
                              ) : null}
                              {section.activeThreads.map((thread) => renderThreadRow(thread, "active"))}
                              {section.snoozedThreads.length > 0 ? (
                                <li data-thread-selection-safe className="list-none">
                                  <button
                                    type="button"
                                    onClick={toggleSnoozedShelf}
                                    aria-expanded={snoozedShelfExpanded}
                                    className="mb-0.5 mt-2 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
                                  >
                                    <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                                      {snoozedShelfExpanded
                                        ? "Snoozed"
                                        : `Snoozed (${section.snoozedThreads.length})`}
                                    </span>
                                    <span className="h-px flex-1 bg-blue-500/20 dark:bg-blue-400/15" />
                                  </button>
                                </li>
                              ) : null}
                              {visibleSnoozed.map((thread) => renderThreadRow(thread, "snoozed"))}
                              {section.settledThreads.length > 0 ? (
                                <li data-thread-selection-safe className="list-none">
                                  <button
                                    type="button"
                                    onClick={toggleSettledShelf}
                                    aria-expanded={settledShelfExpanded}
                                    className="mb-0.5 mt-2 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
                                  >
                                    <span className="text-[11px] font-medium text-muted-foreground/50">
                                      {settledShelfExpanded
                                        ? "Settled"
                                        : `Settled (${section.settledThreads.length})`}
                                    </span>
                                    <span className="h-px flex-1 bg-sidebar-border/60" />
                                  </button>
                                </li>
                              ) : null}
                              {visibleSettled.map((thread) => renderThreadRow(thread, "settled"))}
                              {threadCount === 0 ? (
                                <li className="list-none px-2.5 py-2 text-xs text-sidebar-muted-foreground/50">
                                  No conversations yet
                                </li>
                              ) : null}
                            </ul>
                          ) : null}
                        </li>,
                      );
                    }

                    const visibleUngroupedSnoozed = ungroupedThreads.snoozedThreads.filter(
                      (thread) =>
                        visibleSnoozedThreadKeySet.has(
                          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                        ),
                    );
                    const visibleUngroupedSettled = ungroupedThreads.settledThreads.filter(
                      (thread) =>
                        renderedSettledThreadKeySet.has(
                          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                        ),
                    );
                    const ungroupedCount =
                      ungroupedThreads.pinnedThreads.length +
                      ungroupedThreads.activeThreads.length +
                      ungroupedThreads.snoozedThreads.length +
                      ungroupedThreads.settledThreads.length;
                    if (ungroupedCount > 0) {
                      items.push(
                        <li key="project-section:ungrouped" data-thread-selection-safe className="mt-2 list-none">
                          <div className="flex h-8 items-center gap-2 px-2 text-xs font-semibold text-sidebar-muted-foreground">
                            <FolderIcon className="size-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">Other threads</span>
                            <span className="min-w-4 shrink-0 text-right text-[10px] tabular-nums text-sidebar-muted-foreground/45">
                              {ungroupedCount}
                            </span>
                          </div>
                          <ul
                            role="list"
                            aria-label="Other threads"
                            className="ml-2.5 flex flex-col gap-px border-l border-sidebar-border/50 pl-1.5"
                          >
                            {ungroupedThreads.pinnedThreads.map((thread) => renderThreadRow(thread, "pinned"))}
                            {ungroupedThreads.activeThreads.map((thread) => renderThreadRow(thread, "active"))}
                            {visibleUngroupedSnoozed.map((thread) => renderThreadRow(thread, "snoozed"))}
                            {visibleUngroupedSettled.map((thread) => renderThreadRow(thread, "settled"))}
                          </ul>
                        </li>,
                      );
                    }
                    return items;
                  }
                  if (pinnedThreads.length > 0) {
'''
replace_once(sidebar, anchor, render_grouped)
