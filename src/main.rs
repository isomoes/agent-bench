mod agents;
mod cli;
mod error;
mod evaluator;
mod runner;
mod task;

use clap::Parser;

use cli::{Cli, Commands};

#[tokio::main]
async fn main() {
    // Initialize logger (RUST_LOG=debug for verbose output)
    env_logger::init();

    let cli = Cli::parse();

    let result = match &cli.command {
        Commands::List { verbose } => cli::cmd_list(&cli, *verbose).await,
        Commands::Run { task, suite, agent } => {
            cli::cmd_run(&cli, task.clone(), suite.clone(), agent.clone()).await
        }
    };

    if let Err(e) = result {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
}
