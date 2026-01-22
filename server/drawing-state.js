/**
 * Drawing State Management
 * Maintains operation history for undo/redo and canvas state reconstruction
 */

class DrawingState {
  constructor(roomId) {
    this.roomId = roomId;
    this.operations = []; // All drawing operations
    this.currentIndex = -1; // Current position in operation history
    this.referenceSize = null;
  }

  /**
   * Add a new drawing operation
   */
  addOperation(operation) {
    // Remove any operations after current index (redo history)
    this.operations = this.operations.slice(0, this.currentIndex + 1);

    // Add new operation
    this.operations.push({
      ...operation,
      undone: false
    });

    this.currentIndex++;

    return operation;
  }

  /**
   * Mark the last operation by a specific user as undone
   */
  undo(userId) {
    // Find the last non-undone operation by this user
    for (let i = this.operations.length - 1; i >= 0; i--) {
      const operation = this.operations[i];
      if (operation.userId === userId && !operation.undone) {
        operation.undone = true;
        return operation;
      }
    }
    return null;
  }

  /**
   * Redo the last undone operation by a specific user
   */
  redo(userId) {
    // Find the first undone operation by this user (oldest undone)
    for (let i = 0; i < this.operations.length; i++) {
      const operation = this.operations[i];
      if (operation.userId === userId && operation.undone) {
        operation.undone = false;
        return operation;
      }
    }
    return null;
  }

  /**
   * Global Undo: Undoes the very last active operation regardless of user
   */
  globalUndo() {
    // Find the last non-undone operation
    for (let i = this.operations.length - 1; i >= 0; i--) {
      const operation = this.operations[i];
      if (!operation.undone) {
        operation.undone = true;
        return operation;
      }
    }
    return null;
  }

  /**
   * Global Redo: Redoes the last undone operation regardless of user
   */
  globalRedo() {
    // Find the first undone operation (searching from beginning/oldest or end? 
    // Standard redo typically redoes the *most recently undone* action if we track a redo stack.
    // But our linear history model with 'undone' flags behaves slightly differently.
    // If we want to redo the operation that would "restore" the history line:
    // We should find the first operation that is undone *after* the current active set?

    // Actually, simple linear redo in this model usually means finding the *first* undone operation
    // that appears *after* the last active operation.

    // Let's stick to the same logic as user redo but without user filter:
    // Find first undone operation in the list.

    // Wait, if I undo A, then Undo B. History: [A(undone), B(undone)].
    // Standard Redo would redo B (most recent undo).
    // Our existing user redo: searches from 0 to length. It finds A first.
    // So current user redo is "Redo Oldest Undone"? That seems backwards for standard stack behavior.

    // Let's check `redo(userId)` implementation again.
    // `for (let i = 0; i < this.operations.length; i++)`
    // Yes, it finds the *oldest* undone operation.
    // If I undo A then B. History: A, B. Both undone.
    // Loop starts at 0. Finds A. Redoes A.
    // So it behaves like a "Replay" redo.

    // For Global Redo to match, I will use similar logic.
    for (let i = 0; i < this.operations.length; i++) {
      if (this.operations[i].undone) {
        this.operations[i].undone = false;
        return this.operations[i];
      }
    }
    return null;
  }

  /**
   * Get all active (non-undone) operations
   */
  getActiveOperations() {
    return this.operations.slice(0, this.currentIndex + 1).filter(op => !op.undone);
  }

  /**
   * Get complete operation history for new users
   */
  getOperationHistory() {
    return {
      operations: this.operations,
      currentIndex: this.currentIndex,
      referenceSize: this.referenceSize
    };
  }

  /**
   * Restore state from history (for new users joining)
   */
  restoreFromHistory(history) {
    this.operations = history.operations;
    this.currentIndex = history.currentIndex;
    this.referenceSize = history.referenceSize || null;
  }

  /**
   * Clear all operations
   */
  clear() {
    this.operations = [];
    this.currentIndex = -1;
  }

  /**
   * Get statistics about the drawing state
   */
  getStats() {
    return {
      totalOperations: this.operations.length,
      activeOperations: this.getActiveOperations().length,
      currentIndex: this.currentIndex
    };
  }
}

module.exports = DrawingState;
