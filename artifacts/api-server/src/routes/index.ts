import { Router, type IRouter } from "express";
import farmDirectRouter from "./farmdirect";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(farmDirectRouter);

export default router;
