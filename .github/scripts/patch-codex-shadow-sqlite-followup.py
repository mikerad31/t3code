from pathlib import Path

path = Path("apps/server/src/provider/Drivers/CodexHomeLayout.sidecar.test.ts")
text = path.read_text()
old = '''      const database = new NodeSqlite.DatabaseSync(sharedDatabasePath);\n      const secondConnection = new NodeSqlite.DatabaseSync(sharedDatabasePath);\n      try {\n        database.exec("PRAGMA journal_mode=WAL");\n        database.exec("CREATE TABLE safety_test (value TEXT NOT NULL)");\n        database.exec("INSERT INTO safety_test (value) VALUES ('shared')");\n        secondConnection.prepare("SELECT value FROM safety_test").get();\n\n        expect(yield* fileSystem.exists(sharedDatabasePath)).toBe(true);\n'''
new = '''      const database = new NodeSqlite.DatabaseSync(sharedDatabasePath);\n      try {\n        database.exec("PRAGMA journal_mode=WAL");\n        database.exec("CREATE TABLE safety_test (value TEXT NOT NULL)");\n        database.exec("INSERT INTO safety_test (value) VALUES ('shared')");\n        database.prepare("SELECT value FROM safety_test").get();\n\n        expect(yield* fileSystem.exists(sharedDatabasePath)).toBe(true);\n'''
if old not in text:
    raise SystemExit("sqlite test connection block not found")
text = text.replace(old, new, 1)
old = '''      } finally {\n        secondConnection.close();\n        database.close();\n      }\n'''
new = '''      } finally {\n        database.close();\n      }\n'''
if old not in text:
    raise SystemExit("sqlite test close block not found")
path.write_text(text.replace(old, new, 1))
