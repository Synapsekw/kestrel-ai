import sys

if len(sys.argv) > 1 and sys.argv[1] == "worker":
    from app.training.worker import main as worker_main

    sys.exit(worker_main(sys.argv[2:]))
else:
    from app.main import main

    main()
