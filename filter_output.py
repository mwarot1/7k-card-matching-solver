import sys
import os

def filter_output():
    if not os.path.exists('test_output.txt'):
        print("Error: test_output.txt not found")
        return

    try:
        # Try UTF-16 first (PowerShell default)
        with open('test_output.txt', 'rb') as f:
            raw = f.read()
            try:
                content = raw.decode('utf-16')
            except UnicodeDecodeError:
                content = raw.decode('utf-8')
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    with open('filtered_output.txt', 'w', encoding='utf-8') as out:
        for line in content.splitlines():
            line = line.strip()
            if line.startswith('DEBUG:') or line.startswith('Warning:'):
                out.write(line + '\n')
                print(line)

if __name__ == "__main__":
    filter_output()
