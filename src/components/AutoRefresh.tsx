"use client";

import { useEffect } from "react";

const LAST_ACTIVE_KEY = "lifeDashboard_lastActive";

export default function AutoRefresh() {
  useEffect(() => {
    // Function to check if we should refresh
    const checkAndRefresh = () => {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      const lastActiveStr = localStorage.getItem(LAST_ACTIVE_KEY);
      
      if (lastActiveStr) {
        const lastActive = new Date(lastActiveStr);
        const lastActiveDate = new Date(
          lastActive.getFullYear(),
          lastActive.getMonth(),
          lastActive.getDate()
        );
        
        // If last active was a previous day, refresh the page
        if (lastActiveDate < today) {
          localStorage.setItem(LAST_ACTIVE_KEY, now.toISOString());
          window.location.reload();
          return;
        }
      }
      
      // Update last active time
      localStorage.setItem(LAST_ACTIVE_KEY, now.toISOString());
    };

    // Check immediately when component mounts
    checkAndRefresh();

    // Handle visibility change (when tab becomes visible)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkAndRefresh();
      }
    };

    // Handle focus (when window regains focus)
    const handleFocus = () => {
      checkAndRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    // Cleanup
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  return null;
}

