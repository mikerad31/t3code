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
    '  CheckIcon,\n  ChevronDownIcon,\n',
    '  CheckIcon,\n  ChevronDownIcon,\n  ChevronsUpDownIcon,\n',
)
replace_once(
    sidebar,
    '  isTrailingDoubleClick,\n  orderItemsByPreferredIds,\n',
    '  isTrailingDoubleClick,\n  nextCollapsedProjectSectionKeys,\n  orderItemsByPreferredIds,\n',
)

old_header = '''function SidebarProjectSectionHeader(props: {
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
new_header = '''function SidebarProjectSectionHeader(props: {
  project: SidebarProjectSnapshot;
  expanded: boolean;
  threadCount: number;
  onToggle: () => void;
  onCreateThread: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onImportConversations: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onOpenSettings: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const actionClassName =
    "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground/55 outline-none transition-colors hover:bg-sidebar-control-surface hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="group/project-section relative" data-thread-selection-safe>
      <button
        type="button"
        aria-expanded={props.expanded}
        aria-label={`${props.expanded ? "Collapse" : "Expand"} ${props.project.displayName}`}
        onClick={props.onToggle}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 pr-[5.25rem] text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
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
          <span className="shrink-0 text-[10px] text-sidebar-muted-foreground/45 group-hover/project-section:opacity-0 group-focus-within/project-section:opacity-0 max-sm:hidden">
            {props.project.groupedProjectCount} roots
          </span>
        ) : null}
        <span className="min-w-4 shrink-0 text-right text-[10px] tabular-nums text-sidebar-muted-foreground/45 group-hover/project-section:opacity-0 group-focus-within/project-section:opacity-0 max-sm:hidden">
          {props.threadCount}
        </span>
      </button>
      <div className="pointer-events-none absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/project-section:pointer-events-auto group-hover/project-section:opacity-100 group-focus-within/project-section:pointer-events-auto group-focus-within/project-section:opacity-100 max-sm:pointer-events-auto max-sm:opacity-100">
        <button
          type="button"
          className={actionClassName}
          aria-label={`New thread in ${props.project.displayName}`}
          title={`New thread in ${props.project.displayName}`}
          onClick={props.onCreateThread}
        >
          <SquarePenIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className={actionClassName}
          aria-label={`Import conversations into ${props.project.displayName}`}
          title={`Import conversations into ${props.project.displayName}`}
          onClick={props.onImportConversations}
        >
          <DownloadIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className={actionClassName}
          aria-label={`Project settings for ${props.project.displayName}`}
          title={`Project settings for ${props.project.displayName}`}
          onClick={props.onOpenSettings}
        >
          <SettingsIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
'''
replace_once(sidebar, old_header, new_header)

collapse_anchor = '''  const toggleProjectSection = useCallback(
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
collapse_extra = collapse_anchor + '''  const projectSectionKeys = useMemo(
    () => projectGroups.map((project) => project.projectKey),
    [projectGroups],
  );
  const allProjectSectionsCollapsed =
    projectSectionKeys.length > 0 &&
    projectSectionKeys.every((projectKey) => collapsedProjectSectionKeySet.has(projectKey));
  const toggleAllProjectSections = useCallback(() => {
    setCollapsedProjectSectionKeys((current) =>
      nextCollapsedProjectSectionKeys({
        projectKeys: projectSectionKeys,
        collapsedProjectKeys: current,
      }),
    );
  }, [projectSectionKeys, setCollapsedProjectSectionKeys]);
'''
replace_once(sidebar, collapse_anchor, collapse_extra)

import_anchor = '''  const handleImportConversations = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, projectGroup: SidebarProjectSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      setProjectScopeMenuOpen(false);
      setThreadImportProject(projectGroup);
    },
    [],
  );
'''
create_handler = import_anchor + '''  const handleCreateProjectThread = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, projectGroup: SidebarProjectSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      if (isMobile) setOpenMobile(false);
      void settlePromise(() =>
        newThreadContext.handleNewThread(scopeProjectRef(projectGroup.environmentId, projectGroup.id)),
      ).then((result) => {
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Could not create thread in ${projectGroup.displayName}`,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
    },
    [isMobile, newThreadContext, setOpenMobile],
  );
'''
replace_once(sidebar, import_anchor, create_handler)

menu_anchor = '''                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        className="relative shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onClick={openAddProjectCommandPalette}
                        type="button"
                        aria-label="New project"
                      />
                    }
                  >
                    <FolderPlusIcon />
                    <span
                      className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                      aria-hidden="true"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="right">New project</TooltipPopup>
                </Tooltip>
'''
menu_new = '''                {scopedProjectGroup === null && projectGroups.length > 1 ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <SidebarMenuButton
                          size="icon"
                          className="relative shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                          onClick={toggleAllProjectSections}
                          type="button"
                          aria-label={allProjectSectionsCollapsed ? "Expand all projects" : "Collapse all projects"}
                        />
                      }
                    >
                      <ChevronsUpDownIcon className={cn("transition-transform", allProjectSectionsCollapsed && "rotate-90")} />
                    </TooltipTrigger>
                    <TooltipPopup side="right">
                      {allProjectSectionsCollapsed ? "Expand all projects" : "Collapse all projects"}
                    </TooltipPopup>
                  </Tooltip>
                ) : null}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        className="relative shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onClick={openAddProjectCommandPalette}
                        type="button"
                        aria-label="New project"
                      />
                    }
                  >
                    <FolderPlusIcon />
                    <span
                      className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                      aria-hidden="true"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="right">New project</TooltipPopup>
                </Tooltip>
'''
replace_once(sidebar, menu_anchor, menu_new)

header_usage = '''                          <SidebarProjectSectionHeader
                            project={section.project}
                            expanded={sectionExpanded}
                            threadCount={threadCount}
                            onToggle={() => toggleProjectSection(section.project.projectKey)}
                          />
'''
header_usage_new = '''                          <SidebarProjectSectionHeader
                            project={section.project}
                            expanded={sectionExpanded}
                            threadCount={threadCount}
                            onToggle={() => toggleProjectSection(section.project.projectKey)}
                            onCreateThread={(event) => handleCreateProjectThread(event, section.project)}
                            onImportConversations={(event) =>
                              handleImportConversations(event, section.project)
                            }
                            onOpenSettings={(event) => void handleProjectSettings(event, section.project)}
                          />
'''
replace_once(sidebar, header_usage, header_usage_new)
