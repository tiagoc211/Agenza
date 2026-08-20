const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const currentTodo = JSON.parse(readFileSync('todo.json', 'utf8'));
const archivedTodo010 = JSON.parse(readFileSync('todo-v0.1.0.json', 'utf8'));
const archivedTodo020 = JSON.parse(readFileSync('todo-v0.2.0.json', 'utf8'));

test('archives the completed 0.1.0 release plan', () => {
  assert.equal(archivedTodo010.release, '0.1.0');
  assert.equal(archivedTodo010.archived, true);
  assert.ok(archivedTodo010.tasks.length > 0);
  assert.ok(archivedTodo010.tasks.every(({ status }) => status === 'done'));
});

test('archives the completed 0.2.0 release plan', () => {
  assert.equal(archivedTodo020.release, '0.2.0');
  assert.equal(archivedTodo020.archived, true);
  assert.deepEqual(archivedTodo020.tasks, currentTodo.tasks);
  assert.ok(archivedTodo020.tasks.every(({ status }) => status === 'done'));
});

test('defines an ordered and dependency-safe 0.2.0 plan', () => {
  assert.equal(currentTodo.release, '0.2.0');
  assert.ok(currentTodo.goal.includes('worktrees'));
  assert.ok(currentTodo.tasks.length > 0);

  const taskIds = new Set(currentTodo.tasks.map(({ id }) => id));
  assert.equal(taskIds.size, currentTodo.tasks.length);

  for (const [index, task] of currentTodo.tasks.entries()) {
    assert.equal(task.order, index + 1);
    assert.equal(currentTodo.status_values.includes(task.status), true);
    assert.ok(task.acceptance_criteria.length > 0);

    for (const dependencyId of task.depends_on) {
      assert.equal(
        taskIds.has(dependencyId),
        true,
        `${task.id} has unknown dependency ${dependencyId}`,
      );
      const dependency = currentTodo.tasks.find(({ id }) => id === dependencyId);
      assert.ok(
        dependency.order < task.order,
        `${task.id} depends on a later task ${dependencyId}`,
      );

      if (task.status !== 'todo') {
        assert.equal(
          dependency.status,
          'done',
          `${task.id} started before dependency ${dependencyId} was done`,
        );
      }
    }
  }
});

test('makes terminal removal and destructive Git operations explicitly safe', () => {
  assert.ok(
    currentTodo.release_principles.some((principle) =>
      principle.includes('Removing a terminal never deletes'),
    ),
  );
  assert.ok(
    currentTodo.release_principles.some((principle) =>
      principle.includes('Destructive Git operations require an explicit user action'),
    ),
  );
});
