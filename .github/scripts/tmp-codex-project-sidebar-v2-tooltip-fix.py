from pathlib import Path

sidebar = Path("apps/web/src/components/Sidebar.tsx")
text = sidebar.read_text(encoding="utf-8")

replacements = [
    (
        '''        <button
          type="button"
          className={actionClassName}
          aria-label={`New thread in ${props.project.displayName}`}
          title={`New thread in ${props.project.displayName}`}
          onClick={props.onCreateThread}
        >
          <SquarePenIcon className="size-3.5" />
        </button>''',
        '''        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={actionClassName}
                aria-label={`New thread in ${props.project.displayName}`}
                onClick={props.onCreateThread}
              />
            }
          >
            <SquarePenIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">New thread</TooltipPopup>
        </Tooltip>''',
    ),
    (
        '''        <button
          type="button"
          className={actionClassName}
          aria-label={`Import conversations into ${props.project.displayName}`}
          title={`Import conversations into ${props.project.displayName}`}
          onClick={props.onImportConversations}
        >
          <DownloadIcon className="size-3.5" />
        </button>''',
        '''        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={actionClassName}
                aria-label={`Import conversations into ${props.project.displayName}`}
                onClick={props.onImportConversations}
              />
            }
          >
            <DownloadIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">Import conversations</TooltipPopup>
        </Tooltip>''',
    ),
    (
        '''        <button
          type="button"
          className={actionClassName}
          aria-label={`Project settings for ${props.project.displayName}`}
          title={`Project settings for ${props.project.displayName}`}
          onClick={props.onOpenSettings}
        >
          <SettingsIcon className="size-3.5" />
        </button>''',
        '''        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={actionClassName}
                aria-label={`Project settings for ${props.project.displayName}`}
                onClick={props.onOpenSettings}
              />
            }
          >
            <SettingsIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">Project settings</TooltipPopup>
        </Tooltip>''',
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one tooltip repair anchor, found {count}")
    text = text.replace(old, new, 1)

if 'title={`New thread in ${props.project.displayName}`}' in text:
    raise SystemExit("native new-thread tooltip remains")
if 'title={`Import conversations into ${props.project.displayName}`}' in text:
    raise SystemExit("native import tooltip remains")
if 'title={`Project settings for ${props.project.displayName}`}' in text:
    raise SystemExit("native settings tooltip remains")

sidebar.write_text(text, encoding="utf-8")
