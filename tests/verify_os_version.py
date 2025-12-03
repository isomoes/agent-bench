#!/usr/bin/env python3
"""
Simple verification script for OS version task.
Checks if the OS version was successfully written to the output file.
"""
import os
import sys
import platform

def verify_os_version():
    """Verify that the OS version file exists and contains valid content."""
    output_file = "results/os_version.txt"

    # Check if file exists
    if not os.path.exists(output_file):
        print(f"FAIL: Output file '{output_file}' does not exist")
        return False

    # Read the content
    with open(output_file, 'r') as f:
        content = f.read().strip()

    # Check if content is not empty
    if not content:
        print(f"FAIL: Output file '{output_file}' is empty")
        return False

    # Basic validation - should contain some OS-related keywords
    os_keywords = ['linux', 'darwin', 'macos', 'windows', 'ubuntu', 'debian', 'arch', 'fedora', 'centos']
    content_lower = content.lower()

    if not any(keyword in content_lower for keyword in os_keywords):
        print(f"FAIL: Content '{content}' does not appear to be an OS version")
        return False

    # Get actual OS for comparison
    actual_os = platform.system().lower()

    # Verify the content matches the actual OS
    os_match = {
        'linux': 'linux',
        'darwin': ['macos', 'darwin', 'mac'],
        'windows': 'windows'
    }

    expected_keywords = os_match.get(actual_os, [])
    if isinstance(expected_keywords, str):
        expected_keywords = [expected_keywords]

    if not any(keyword in content_lower for keyword in expected_keywords):
        print(f"FAIL: Content '{content}' does not match actual OS '{actual_os}'")
        return False

    print(f"PASS: OS version correctly detected: {content}")
    return True

if __name__ == "__main__":
    success = verify_os_version()
    sys.exit(0 if success else 1)
