// node-pty creates a new session for this program. Keep that session leader
// alive while the real interactive shell owns the foreground process group.
// On loss of the Agent, reap jobs in this terminal's session, not other PTYs
// or deliberately detached jobs. No Node runtime or second output pipe.
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <time.h>

static volatile sig_atomic_t ending;
static void stop(int sig) { (void)sig; ending = 1; }

static void reap_session(pid_t session) {
    // Fixed absolute executable and arguments; repository/shell input never
    // becomes a command. Re-check membership immediately before signalling.
    FILE *processes = popen("/bin/ps -A -o pid=", "r");
    if (!processes) return;
    pid_t pid;
    while (fscanf(processes, "%d", &pid) == 1)
        if (pid > 1 && pid != session && getsid(pid) == session) kill(pid, SIGKILL);
    pclose(processes);
}

int main(int argc, char **argv) {
    if (argc != 3 || !argv[1][0]) return 126;
    char *end = NULL;
    const pid_t parent = (pid_t)strtol(argv[2], &end, 10), self = getpid();
    if (!end || *end || parent <= 1 || getppid() != parent || getsid(0) != self) return 126;
    struct sigaction act = {0};
    act.sa_handler = stop;
    sigemptyset(&act.sa_mask);
    sigaction(SIGHUP, &act, NULL); sigaction(SIGTERM, &act, NULL);
    signal(SIGTTOU, SIG_IGN);
    int start[2];
    if (pipe(start) != 0) return 126;
    const pid_t shell = fork();
    if (shell < 0) return 126;
    if (shell == 0) {
        close(start[1]); char go;
        if (read(start[0], &go, 1) != 1) _exit(126);
        close(start[0]);
        signal(SIGTTOU, SIG_DFL); signal(SIGTERM, SIG_DFL); signal(SIGHUP, SIG_DFL);
        execl(argv[1], argv[1], "-i", (char *)NULL);
        _exit(127);
    }
    close(start[0]);
    if (setpgid(shell, shell) != 0 || tcsetpgrp(STDIN_FILENO, shell) != 0 ||
        write(start[1], "x", 1) != 1) ending = 1;
    close(start[1]);
    int status = 0;
    while (!ending && getppid() == parent) {
        pid_t done = waitpid(shell, &status, WNOHANG);
        if (done == shell || (done < 0 && errno != EINTR)) break;
        struct timespec tick = {0, 100000000};
        nanosleep(&tick, NULL);
    }
    if (ending || getppid() != parent) {
        kill(-shell, SIGKILL);
        reap_session(self);
        while (waitpid(shell, &status, 0) < 0 && errno == EINTR) {}
    }
    if (WIFSIGNALED(status)) { int sig = WTERMSIG(status); signal(sig, SIG_DFL); raise(sig); }
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
