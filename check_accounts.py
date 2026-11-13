
import sqlite3
import os

db_path = "backend/brandguard.db"

if not os.path.exists(db_path):
    print("Database file not found:", db_path)
    exit()

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("\n--- BRANDGUARD AI DATABASE TABLES ---")

cursor.execute("""
    SELECT name FROM sqlite_master
    WHERE type='table'
""")

tables = cursor.fetchall()

for table in tables:
    print(table[0])

print("\n--- USER ACCOUNT COUNT ---")

if any(table[0] == "users" for table in tables):
    cursor.execute("SELECT COUNT(*) FROM users")
    print("Total registered accounts:", cursor.fetchone()[0])
else:
    print("No users table found.")

print("\n--- USER TABLE COLUMNS ---")

cursor.execute("PRAGMA table_info(users)")

for column in cursor.fetchall():
    print(column[1], "-", column[2])

print("\n--- SESSION TABLES ---")

for table in tables:
    if any(word in table[0].lower() for word in ["session", "token"]):
        print(table[0])

conn.close()