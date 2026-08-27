from pathlib import Path


def replace_once(path_str: str, old: str, new: str, label: str) -> None:
    path = Path(path_str)
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


sidebar = "apps/web/src/components/Sidebar.tsx"

replace_once(
    sidebar,
    '''  ClockIcon,
  FolderIcon,''',
    '''  ClockIcon,
  DownloadIcon,
  FolderIcon,''',
    "download icon import",
)

replace_once(
    sidebar,
    '''import { ProjectFavicon } from "./ProjectFavicon";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";''',
    '''import { ProjectFavicon } from "./ProjectFavicon";
import { ThreadImportDialog } from "./ThreadImportDialog";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";''',
    "thread import dialog import",
)

replace_once(
    sidebar,
    '''  const [projectScopeMenuOpen, setProjectScopeMenuOpen] = useState(false);
  const newThreadContext = useHandleNewThread();''',
    '''  const [projectScopeMenuOpen, setProjectScopeMenuOpen] = useState(false);
  const [threadImportProject, setThreadImportProject] = useState<SidebarProjectSnapshot | null>(null);
  const newThreadContext = useHandleNewThread();''',
    "thread import project state",
)

replace_once(
    sidebar,
    '''  const handleProjectSettings = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, projectGroup: SidebarProjectSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      setProjectScopeMenuOpen(false);
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/projects/$projectKey",
        params: { projectKey: projectGroup.projectKey },
      });
    },
    [isMobile, router, setOpenMobile],
  );
''',
    '''  const handleProjectSettings = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, projectGroup: SidebarProjectSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      setProjectScopeMenuOpen(false);
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/projects/$projectKey",
        params: { projectKey: projectGroup.projectKey },
      });
    },
    [isMobile, router, setOpenMobile],
  );

  const handleImportConversations = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, projectGroup: SidebarProjectSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      setProjectScopeMenuOpen(false);
      setThreadImportProject(projectGroup);
    },
    [],
  );
''',
    "thread import handler",
)

replace_once(
    sidebar,
    '''      <SidebarChromeHeader isElectron={isElectron} />''',
    '''      <ThreadImportDialog
        open={threadImportProject !== null}
        onOpenChange={(open) => {
          if (!open) setThreadImportProject(null);
        }}
        projectTitle={threadImportProject?.displayName ?? "project"}
        targets={
          threadImportProject?.memberProjectRefs.map((projectRef) => ({
            environmentId: projectRef.environmentId,
            projectId: projectRef.projectId,
            environmentLabel:
              environmentLabelById.get(projectRef.environmentId) ?? String(projectRef.environmentId),
          })) ?? []
        }
      />
      <SidebarChromeHeader isElectron={isElectron} />''',
    "thread import dialog render",
)

replace_once(
    sidebar,
    '''                            <Button
                              size="icon-xs"
                              variant="ghost-muted"
                              aria-label={`Project settings for ${project.displayName}`}''',
    '''                            <Button
                              size="icon-xs"
                              variant="ghost-muted"
                              aria-label={`Import conversations into ${project.displayName}`}
                              title={`Import conversations into ${project.displayName}`}
                              className="ml-auto size-6 [--control-icon-color:currentColor] text-icon-muted focus-visible:bg-accent focus-visible:text-foreground"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                handleImportConversations(event, project);
                              }}
                            >
                              <DownloadIcon className="size-3.5" />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost-muted"
                              aria-label={`Project settings for ${project.displayName}`}''',
    "project import action",
)
