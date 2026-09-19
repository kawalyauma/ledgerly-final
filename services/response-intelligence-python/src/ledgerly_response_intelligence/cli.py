from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import uvicorn

from .config import get_settings
from .engine import ResponseIntelligenceEngine
from .models import ResponseRequest
from .training.datasets import DatasetBuilder
from .training.models import AdapterRegister, DatasetExportRequest, FineTuneConfig
from .training.store import TrainingStore
from .training.trainer import train_adapter


async def _respond(path: Path) -> None:
    payload = json.loads(path.read_text(encoding="utf-8"))
    request = ResponseRequest.model_validate(payload)
    result = await ResponseIntelligenceEngine(get_settings()).respond(request)
    print(result.model_dump_json(indent=2))


def _store() -> TrainingStore:
    settings=get_settings()
    return TrainingStore(
        settings.training_db_path,
        privacy_mode=settings.training_privacy_mode,
        min_sft_examples=settings.training_min_sft_examples,
        min_preference_examples=settings.training_min_preference_examples,
    )


def _export(args: argparse.Namespace) -> None:
    settings=get_settings()
    builder=DatasetBuilder(_store(),settings.training_dataset_dir,settings.training_privacy_mode)
    result=builder.export(DatasetExportRequest(
        organization_id=args.organization,format=args.format,min_quality=args.min_quality,
        include_global=args.include_global,filename=args.filename or "",
    ))
    print(result.model_dump_json(indent=2))


def _stats(args: argparse.Namespace) -> None:
    print(_store().stats(args.organization).model_dump_json(indent=2))


def _train(args: argparse.Namespace) -> None:
    settings=get_settings()
    store=_store()
    dataset=args.dataset
    if not dataset:
        export_format="dpo" if args.objective=="dpo" else "sft"
        exported=DatasetBuilder(store,settings.training_dataset_dir,settings.training_privacy_mode).export(
            DatasetExportRequest(
                organization_id=args.organization,format=export_format,
                min_quality=args.min_quality,include_global=args.include_global,
            )
        )
        dataset=exported.path
        if exported.examples<2:
            raise SystemExit(f"Not enough {export_format.upper()} examples to train: {exported.examples}")

    output=args.output or str(Path(settings.training_adapter_dir)/(args.name or f"{args.objective}-{args.mode}"))
    config=FineTuneConfig(
        organization_id=args.organization,objective=args.objective,base_model=args.base_model,
        dataset_path=dataset,output_dir=output,mode=args.mode,epochs=args.epochs,
        learning_rate=args.learning_rate,batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation,max_length=args.max_length,
        lora_r=args.lora_r,lora_alpha=args.lora_alpha,lora_dropout=args.lora_dropout,dpo_beta=args.dpo_beta,
    )
    run=store.create_training_run(config)
    try:
        outcome=train_adapter(config)
        store.finish_training_run(run.run_id,status="completed",metrics=outcome.metrics)
        adapter=store.register_adapter(AdapterRegister(
            organization_id=args.organization,name=args.name or Path(output).name,
            base_model=args.base_model,path=outcome.output_dir,metrics=outcome.metrics,activate=args.activate,
        ))
        print(json.dumps({
            "run":store.get_training_run(run.run_id).model_dump(mode="json"),
            "adapter":adapter.model_dump(mode="json"),
        },ensure_ascii=False,indent=2))
    except Exception as exc:
        store.finish_training_run(run.run_id,status="failed",metrics={"error":str(exc)})
        raise


def main() -> None:
    parser = argparse.ArgumentParser(prog="ledgerly-response-intelligence")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("serve")

    respond = sub.add_parser("respond")
    respond.add_argument("file", type=Path)

    stats=sub.add_parser("training-stats")
    stats.add_argument("--organization",default="")

    export=sub.add_parser("export-dataset")
    export.add_argument("--organization",default="")
    export.add_argument("--format",choices=["sft","dpo"],default="sft")
    export.add_argument("--min-quality",type=float,default=0.82)
    export.add_argument("--include-global",action="store_true")
    export.add_argument("--filename",default="")

    train=sub.add_parser("train-adapter")
    train.add_argument("--organization",default="")
    train.add_argument("--objective",choices=["sft","dpo"],default="sft")
    train.add_argument("--mode",choices=["lora","qlora"],default="lora")
    train.add_argument("--base-model",required=True)
    train.add_argument("--dataset",default="")
    train.add_argument("--output",default="")
    train.add_argument("--name",default="")
    train.add_argument("--activate",action="store_true")
    train.add_argument("--include-global",action="store_true")
    train.add_argument("--min-quality",type=float,default=0.82)
    train.add_argument("--epochs",type=float,default=2.0)
    train.add_argument("--learning-rate",type=float,default=1e-4)
    train.add_argument("--batch-size",type=int,default=1)
    train.add_argument("--gradient-accumulation",type=int,default=8)
    train.add_argument("--max-length",type=int,default=2048)
    train.add_argument("--lora-r",type=int,default=16)
    train.add_argument("--lora-alpha",type=int,default=32)
    train.add_argument("--lora-dropout",type=float,default=0.05)
    train.add_argument("--dpo-beta",type=float,default=0.1)

    args = parser.parse_args()
    settings = get_settings()
    if args.command == "serve":
        uvicorn.run(
            "ledgerly_response_intelligence.api:app",
            host=settings.host,
            port=settings.port,
            log_level=settings.log_level.lower(),
        )
    elif args.command=="respond":
        asyncio.run(_respond(args.file))
    elif args.command=="training-stats":
        _stats(args)
    elif args.command=="export-dataset":
        _export(args)
    elif args.command=="train-adapter":
        _train(args)


if __name__ == "__main__":
    main()
