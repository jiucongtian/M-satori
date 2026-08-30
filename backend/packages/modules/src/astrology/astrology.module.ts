import { Global, Module } from '@nestjs/common';
import { BIRTH_CHART_CALCULATOR } from '@satori/application';
import { ReferenceBirthChartCalculator } from './reference-birth-chart.calculator.js';

@Global()
@Module({
  providers: [{ provide: BIRTH_CHART_CALCULATOR, useClass: ReferenceBirthChartCalculator }],
  exports: [BIRTH_CHART_CALCULATOR],
})
export class AstrologyModule {}
