// Keep update restarts from interrupting active or queued application work.
function createJobActivity({ timeoutMs = 30000 } = {}) {
  const jobs = new Set();
  let paused = false;

  function run(task) {
    if (paused) return Promise.reject(new Error('An update restart is pending. Try again after restarting or cancelling the update.'));
    const job = Promise.resolve().then(task);
    jobs.add(job);
    job.then(() => jobs.delete(job), () => jobs.delete(job));
    return job;
  }

  async function pauseAndDrain() {
    if (paused) throw new Error('An update restart is already pending.');
    paused = true;
    let timeout;
    try {
      const results = await Promise.race([
        Promise.allSettled([...jobs]),
        new Promise((resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('Work is still running. Finish the current job and try installing again.')), timeoutMs);
        })
      ]);
      if (results.some(result => result.status === 'rejected')) {
        throw new Error('A job failed while preparing the update. Review the result and try installing again.');
      }
    } catch (error) {
      paused = false;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { run, pauseAndDrain, resume: () => { paused = false; }, isPaused: () => paused };
}

const jobActivity = createJobActivity();
module.exports = { createJobActivity, jobActivity };
