import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { ThreeUp } from "@/components/ThreeUp";
import { UseCases } from "@/components/UseCases";
import { HowItWorks } from "@/components/HowItWorks";
import { Benefits } from "@/components/Benefits";
import { OpenCore } from "@/components/OpenCore";
import { Pricing } from "@/components/Pricing";
import { Faq } from "@/components/Faq";
import { CloseCta } from "@/components/CloseCta";
import { Footer } from "@/components/Footer";

/* section order and ids follow the template:
   hero → about → features → how-it-works → benefits →
   open-source → pricing → faq → final-cta → footer */
export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <ThreeUp />
        <UseCases />
        <HowItWorks />
        <Benefits />
        <OpenCore />
        <Pricing />
        <Faq />
        <CloseCta />
      </main>
      <Footer />
    </>
  );
}
