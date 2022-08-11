import chalk from "chalk";
import {Job} from "./job";
import {assert} from "./asserts";
import {Argv} from "./argv";
import {ExitError} from "./exit-error";

export class Executor {

    static async runLoop (argv: Argv, jobs: ReadonlyArray<Job>, stages: readonly string[], potentialStarters: Job[]) {
        let runningJobs = [];
        let startCandidates = [];

        do {
            startCandidates = Executor.getStartCandidates(jobs, stages, potentialStarters, argv.manual);
            startCandidates.forEach(j => j.start().then());
            runningJobs = Executor.getRunning(jobs);
            await new Promise<void>((resolve) => { setTimeout(() => { resolve(); }, 5); });
        } while (runningJobs.length > 0);
    }

    static getStartCandidates (jobs: ReadonlyArray<Job>, stages: readonly string[], potentialStarters: readonly Job[], manuals: string[]) {
        const startCandidates = [];

        potentialStarters = potentialStarters.filter(job => job.shouldExecuteBasedOnRuleExisting());

        for (const job of [...new Set<Job>(potentialStarters)]) {
            if (job.started) continue;

            const jobsToWaitFor = Executor.getPastToWaitFor(jobs, stages, job, manuals);
            if (Executor.isNotFinished(jobsToWaitFor)) {
                continue;
            }
            if (job.when === "on_success" && Executor.isPastFailed(jobsToWaitFor)) {
                continue;
            }
            if (job.when === "on_failure" && !Executor.isPastFailed(jobsToWaitFor)) {
                continue;
            }

            startCandidates.push(job);
        }
        return startCandidates;
    }

    static isPastFailed (jobsToWaitFor: ReadonlyArray<Job>) {
        const failJobs = jobsToWaitFor.filter(j => {
            if (j.allowFailure) {
                return false;
            }
            return (j.preScriptsExitCode ? j.preScriptsExitCode : 0) > 0;
        });
        return failJobs.length > 0;
    }

    static isNotFinished (jobsToWaitFor: ReadonlyArray<Job>) {
        const notFinishedJobs = jobsToWaitFor.filter(j => !j.finished);
        return notFinishedJobs.length > 0;
    }

    static getRunning (jobs: ReadonlyArray<Job>) {
        return jobs.filter(j => j.running);
    }

    static getFailed (jobs: ReadonlyArray<Job>) {
        return jobs.filter(j => j.finished && !j.allowFailure && (j.preScriptsExitCode ?? 0) > 0);
    }

    static getPastToWaitFor (jobs: ReadonlyArray<Job>, stages: readonly string[], job: Job, manuals: string[]) {
        const jobsToWaitForSet = new Set<Job>();
        let waitForLoopArray: Job[] = [job];

        while (waitForLoopArray.length > 0) {
            const loopJob = waitForLoopArray.pop();
            assert(loopJob != null, "Job not found in getPastToWaitFor, should be impossible!");
            if (loopJob.needs) {
                const neededToWaitFor = this.getNeededToWaitFor(jobs, manuals, loopJob);
                waitForLoopArray.push(...neededToWaitFor);
            } else {
                const previousToWaitFor = this.getPreviousToWaitFor(jobs, stages, loopJob);
                waitForLoopArray = waitForLoopArray.concat(previousToWaitFor);
                waitForLoopArray = waitForLoopArray.filter(j => j.when !== "never");
                waitForLoopArray = waitForLoopArray.filter(j => j.when !== "manual" || manuals.includes(j.name));
            }
            waitForLoopArray.forEach(j => jobsToWaitForSet.add(j));
        }
        return [...jobsToWaitForSet];
    }

    static getNeededToWaitFor (jobs: ReadonlyArray<Job>, manuals: string[], job: Job) {
        const toWaitFor = [];
        assert(job.needs != null, chalk`${job.name}.needs cannot be null in getNeededToWaitFor`);
        for (const need of job.needs) {
            const baseJobs = jobs.filter(j => j.baseName === need.job);
            for (const j of baseJobs) {
                if (j.when === "never") {
                    throw new ExitError(chalk`{blueBright ${j.name}} is when:never, but its needed by {blueBright ${job.name}}`);
                }
                if (j.when === "manual" && !manuals.includes(j.name)) {
                    throw new ExitError(chalk`{blueBright ${j.name}} is when:manual, its needed by {blueBright ${job.name}}, and not specified in --manual`);
                }
                toWaitFor.push(j);
            }
        }
        return toWaitFor;
    }

    static getPreviousToWaitFor (jobs: ReadonlyArray<Job>, stages: readonly string[], job: Job) {
        const previousToWaitFor: Job[] = [];
        const stageIndex = stages.indexOf(job.stage);
        const pastStages = stages.slice(0, stageIndex);
        pastStages.forEach((pastStage) => {
            previousToWaitFor.push(...[...jobs.values()].filter(j => j.stage === pastStage));
        });
        return previousToWaitFor;
    }
}
